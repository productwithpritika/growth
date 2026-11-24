// Forecast, simulator, tenant-switching and region checks (Phase 1 §1.5–1.7 and acceptance).
import type { TenantPack } from "@/tenants/schema";
import type { RegionPack } from "@/tenants/region-schema";
import { forecastRunOut, weekdayWeights, type DayUse } from "@/core/forecast";
import { copy, primaryMeter } from "@/core/pack";
import { meterTimeline } from "@/core/forecasting";
import { chargedTotal, fmtMoney, fmtPrice, needsStrongAuth, overMandateLimit } from "@/core/money";
import { seedTenant } from "@/sim/seed";
import { simConfigFor, simulate90 } from "@/sim/usage90";
import { CHAT_INTENTS } from "@/sim/usage90-types";
import { check, close, eq, type Suite } from "@/core/checks/harness";

const days = (n: number, f: (i: number, dow: number) => number, startDow = 1): DayUse[] => Array.from({ length: n }, (_, i) => ({ dow: (startDow + i) % 7, used: f(i, (startDow + i) % 7) }));

export function forecastSuite(): Suite {
  return {
    id: "forecast",
    title: "Forecasts",
    covers: "§1.5: trailing 7-day burn, weekday weighting, run-out date and confidence band",
    cases: [
      {
        id: "base",
        name: "Trailing 7-day burn sets the daily rate",
        run: () => {
          const f = forecastRunOut({ history: days(14, (i) => (i < 7 ? 2 : 10)), balance: 1000, todayDow: 0, horizon: 30 });
          close(f.base, 10, "base rate", 0.6);
          return `last 7 days at 10 a day → base ${f.base} (earlier week at 2 ignored)`;
        },
      },
      {
        id: "weekday",
        name: "Weekday weighting: quiet weekends project lower than weekdays",
        run: () => {
          const hist = days(21, (_i, dow) => (dow === 0 || dow === 6 ? 2 : 12));
          const w = weekdayWeights(hist);
          check(w[6] < 0.5 && w[0] < 0.5, `weekend weights ${w[0].toFixed(2)}, ${w[6].toFixed(2)}`);
          check(w[1] > 1.1, `Monday weight ${w[1].toFixed(2)}`);
          const f = forecastRunOut({ history: hist, balance: 10_000, todayDow: 0, horizon: 7 });
          const sat = f.days.find((d) => d.dow === 6)!;
          const mon = f.days.find((d) => d.dow === 1)!;
          check(sat.expected < mon.expected / 2, `Saturday ${sat.expected} vs Monday ${mon.expected}`);
          return `Mon ×${w[1].toFixed(2)}, Sat ×${w[6].toFixed(2)}`;
        },
      },
      {
        id: "runout",
        name: "Run-out date is the first day projected use reaches the balance",
        run: () => {
          const f = forecastRunOut({ history: days(14, () => 10), balance: 50, todayDow: 0, horizon: 30, prior: [1, 1, 1, 1, 1, 1, 1] });
          eq(f.runOut.mid, 5, "run-out day");
          const g = forecastRunOut({ history: days(14, () => 10), balance: 50, todayDow: 0, horizon: 30, prior: [1, 1, 1, 1, 1, 1, 1], inflow: () => 5 });
          eq(g.runOut.mid, 10, "with 5 a day arriving");
          const z = forecastRunOut({ history: days(14, () => 0), balance: 50, todayDow: 0, horizon: 30 });
          eq(z.runOut.mid, null, "no use, no run-out");
          return "50 left at 10 a day → day 5; with a daily grant of 5 → day 10";
        },
      },
      {
        id: "band",
        name: "The confidence band brackets the estimate and widens with time",
        run: () => {
          const noisy = days(21, (i) => 10 + ((i * 7) % 5) * 3 - 6);
          const f = forecastRunOut({ history: noisy, balance: 120, todayDow: 0, horizon: 30 });
          check(f.runOut.early! <= f.runOut.mid! && f.runOut.mid! <= f.runOut.late!, `early ${f.runOut.early} ≤ mid ${f.runOut.mid} ≤ late ${f.runOut.late}`);
          const w1 = f.days[0].cumHi - f.days[0].cumLo;
          const w9 = f.days[8].cumHi - f.days[8].cumLo;
          check(w9 > w1, "band widens");
          return `run-out between day ${f.runOut.early} and ${f.runOut.late}, most likely ${f.runOut.mid} · ${f.confidence} confidence`;
        },
      },
    ],
  };
}

export function simSuite(packs: TenantPack[], anchor: string): Suite {
  const pack = packs[0];
  return {
    id: "sim",
    title: "Usage simulator",
    covers: "§1.6 · acceptance: identical output for the same seed",
    cases: [
      {
        id: "determinism",
        name: "Two runs with the same seed give identical output",
        run: () => {
          const cfg = simConfigFor(pack);
          const a = simulate90(pack, cfg, anchor);
          const b = simulate90(pack, cfg, anchor);
          eq(a.hash, b.hash, "hash");
          eq(JSON.stringify(a.cohorts), JSON.stringify(b.cohorts), "cohort tables");
          const c = simulate90(pack, { ...cfg, seed: cfg.seed + 1 }, anchor);
          check(c.hash !== a.hash, "a different seed changes the output");
          return `${pack.company} seed ${cfg.seed}: ${a.hash} both times (${a.ms + b.ms} ms); seed ${cfg.seed + 1}: ${c.hash}`;
        },
      },
      {
        id: "shape",
        name: "About 2,000 workspaces over 90 days, with enrichment, outcome, model and plan mixes",
        run: () => {
          const cfg = simConfigFor(pack);
          const o = simulate90(pack, cfg, anchor);
          eq(o.workspaces.length, cfg.workspaces, "workspaces");
          eq(o.daily.length, cfg.days, "days");
          for (const e of cfg.enrichments) check(o.daily.some((d) => (d.byEnrichment[e.id] ?? 0) > 0), `no ${e.label} runs`);
          for (const oc of cfg.outcomes) check(o.daily.some((d) => (d.outcomes[oc.id] ?? 0) > 0) || !cfg.enrichments.some((e) => oc.id in e.outcomes), `no ${oc.label} outcomes`);
          check(o.totals.defaultModelShare > 0.5, "most model-choice runs stay on the default");
          check(o.totals.topUpBuyers > 0 && o.totals.churnedInWindow > 0 && o.totals.neverRan > 0 && o.totals.quiet > 0, "behaviours present");
          return `${o.totals.runs.toLocaleString("en-US")} runs · ${Math.round(o.totals.defaultModelShare * 100)}% on the default model · ${o.totals.topUpBuyers} top-up buyers · ${o.totals.churnedInWindow} churned`;
        },
      },
      {
        id: "tunable",
        name: "Behaviour shares are tunable: more model switching lowers the default-model share",
        run: () => {
          const cfg = simConfigFor(pack);
          const a = simulate90(pack, { ...cfg, workspaces: 600 }, anchor);
          const b = simulate90(pack, { ...cfg, workspaces: 600, behaviours: { ...cfg.behaviours, switchModels: 0.6, stayOnDefault: 0.35 } }, anchor);
          check(b.totals.defaultModelShare < a.totals.defaultModelShare - 0.1, `${a.totals.defaultModelShare} → ${b.totals.defaultModelShare}`);
          const q = simulate90(pack, { ...cfg, workspaces: 600, behaviours: { ...cfg.behaviours, freeNeverRun: 0.6 } }, anchor);
          check(q.totals.neverRan > a.totals.neverRan, "never-run share moves never-ran count");
          return `default-model share ${Math.round(a.totals.defaultModelShare * 100)}% → ${Math.round(b.totals.defaultModelShare * 100)}%`;
        },
      },
      {
        id: "cohorts-chats",
        name: "Cohort tables by signup month, plan, region and source; 25 help chats tagged by intent",
        run: () => {
          const o = simulate90(pack, simConfigFor(pack), anchor);
          for (const k of ["signupMonth", "plan", "region", "source"] as const) {
            check(o.cohorts[k].length > 1, `${k} table`);
            eq(o.cohorts[k].reduce((s, r) => s + r.workspaces, 0), o.workspaces.length, `${k} rows add up`);
          }
          eq(o.chats.length, 25, "chats");
          const ids = new Set(CHAT_INTENTS.map((i) => i.id));
          check(o.chats.every((c) => ids.has(c.intent) && c.messages.length >= 2), "every chat has an intent and a conversation");
          return `${o.cohorts.signupMonth.length} signup months · ${new Set(o.chats.map((c) => c.intent)).size} intents`;
        },
      },
    ],
  };
}

/** What a surface reads from a pack: if these differ, switching tenants changed the product with no code change. */
export function surfaceModel(pack: TenantPack) {
  const s = seedTenant(pack, "2026-11-23T04:00:00.000Z");
  return {
    meters: pack.meters.map((m) => m.label),
    title: copy(pack, "hub.title", "Credits Hub"),
    topUps: copy(pack, "topups.title", "Top-up packs"),
    limits: { rpm: pack.limits.rate.runsPerMinute, tierCaps: pack.limits.spend.tierCaps, topUpCap: pack.autoTopUp.monthlySpendLimit },
    plans: pack.plans.map((p) => p.name),
    workUnit: pack.workUnit.many,
    firstForecast: meterTimeline(s, "dev", primaryMeter(pack).id).rate,
  };
}

export function tenantSuite(packs: TenantPack[]): Suite {
  return {
    id: "tenants",
    title: "Tenant switching",
    covers: "Acceptance: BuilderCo and APICo change meters, copy and limits with no code change",
    cases: [
      {
        id: "switch",
        name: "The same code renders each pack's meters, copy and limits",
        run: () => {
          const models = packs.map((p) => ({ id: p.company, m: surfaceModel(p) }));
          for (let i = 0; i < models.length; i++)
            for (let j = i + 1; j < models.length; j++) {
              const a = models[i].m;
              const b = models[j].m;
              check(JSON.stringify(a.meters) !== JSON.stringify(b.meters), `${models[i].id} and ${models[j].id} share meters`);
              check(a.title !== b.title || a.topUps !== b.topUps, `${models[i].id} and ${models[j].id} share copy`);
              check(JSON.stringify(a.limits) !== JSON.stringify(b.limits), `${models[i].id} and ${models[j].id} share limits`);
            }
          return models.map((x) => `${x.id}: ${x.m.meters.join(" + ")} · "${x.m.title}" · ${x.m.limits.rpm} runs/min${x.m.limits.tierCaps ? " · tier caps" : ""}`).join(" | ");
        },
      },
      {
        id: "edit",
        name: "Editing a pack's JSON changes the surface without a code change",
        run: () => {
          const p = JSON.parse(JSON.stringify(packs[0])) as TenantPack;
          p.copy = { ...p.copy, "hub.title": "Usage & credits" };
          p.meters[0] = { ...p.meters[0], label: "Research Credits" };
          const m = surfaceModel(p);
          eq([m.title, m.meters[0]], ["Usage & credits", "Research Credits"], "edited pack");
          return `"${m.title}" · ${m.meters[0]}`;
        },
      },
    ],
  };
}

export function regionSuite(regions: RegionPack[]): Suite {
  const r = (id: string) => regions.find((x) => x.id === id)!;
  return {
    id: "regions",
    title: "Regions and policy",
    covers: "§1.7: currency, tax display, strong authentication, recurring consent, auto-renewal",
    cases: [
      {
        id: "packs",
        name: "US, EU and India region packs load and differ",
        run: () => {
          eq(regions.map((x) => x.id).sort(), ["eu", "in", "us"], "regions");
          eq(regions.map((x) => x.currency.code).sort(), ["EUR", "INR", "USD"], "currencies");
          return regions.map((x) => `${x.shortName}: ${x.currency.code}, ${x.tax.name} ${x.tax.display}`).join(" · ");
        },
      },
      {
        id: "money",
        name: "Prices convert and follow the region's tax display",
        run: () => {
          const out = [fmtPrice(185, r("us")), fmtPrice(185, r("eu")), fmtPrice(185, r("in"))];
          check(out[0].includes("185"), out[0]);
          close(chargedTotal(100, r("eu")), 110.4, "EU gross (0.92 × 1.2)", 0.01);
          close(chargedTotal(100, r("in")), 9912, "India gross (84 × 1.18)", 0.5);
          check(fmtMoney(97.5, r("in")).includes("8,190"), fmtMoney(97.5, r("in")));
          return `Launch $185 → ${out.join(" · ")}`;
        },
      },
      {
        id: "sca",
        name: "Strong authentication: never in the US, EU from €30, India on every card payment",
        run: () => {
          eq([needsStrongAuth(500, r("us")), needsStrongAuth(20, r("eu")), needsStrongAuth(40, r("eu")), needsStrongAuth(1, r("in"))], [false, false, true, true], "prompts");
          eq([overMandateLimit(150, r("in")), overMandateLimit(250, r("in"))], [false, true], "India e-mandate limit ₹15,000");
          return "US none · EU 3-D Secure ≥ €30 · India OTP always; auto top-ups above ₹15,000 need OTP";
        },
      },
    ],
  };
}
