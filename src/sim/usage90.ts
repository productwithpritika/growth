// The 90-day population simulator (Phase 1 §1.6). A fixed seed generates about 2,000
// workspaces and runs them day by day: what they enrich, what comes back, which model they
// use, which plan they are on, when they top up, go quiet or churn. Every behaviour share is
// tunable. The same pack, config and anchor date always give the same output (and hash).
import type { SimConfig, TenantPack } from "@/tenants/schema";
import { addDays, fnv1a, mulberry32, normal, r2 } from "@/core/time";
import { grantRule, monthlyAllowance, packFor, planOf, primaryMeter, rateOf } from "@/core/pack";
import { DEFAULT_WEEKDAY } from "@/core/forecast";
import { helpChats } from "@/sim/chats";
import { evalsFor } from "@/sim/evals";
import type { CohortDimension, CohortRow, CohortTables, DailyRow, ModelBehaviour, ModelUse, SimOutput, SimTotals, WorkspaceSummary } from "@/sim/usage90-types";

/** How far before the window workspaces may have signed up, so cohorts have history. */
export const HISTORY_DAYS = 120;
const QUIET_WINDOW = 14;

const DEFAULT_BEHAVIOURS: SimConfig["behaviours"] = { churnAfter3Months: 0.15, addTopUps: 0.25, switchModels: 0.15, stayOnDefault: 0.7, freeGoQuiet: 0.45, freeNeverRun: 0.25 };

/** Source effects: referrals stick, paid search tries and leaves. Multipliers on churn and never-run. */
const SOURCE_EFFECT: Record<string, { churn: number; neverRun: number }> = {
  organic: { churn: 1, neverRun: 1 },
  "paid-search": { churn: 1.25, neverRun: 1.35 },
  referral: { churn: 0.7, neverRun: 0.7 },
  partner: { churn: 0.85, neverRun: 0.9 },
  outbound: { churn: 1.1, neverRun: 1.15 },
};

/** The pack's simulator config, or one derived from its rate card when the pack has none. */
export function simConfigFor(pack: TenantPack): SimConfig {
  if (pack.demo.sim) return pack.demo.sim;
  const prim = primaryMeter(pack).id;
  const items = pack.rateCard.filter((r) => (r.costs[prim] ?? 0) > 0).slice(0, 4);
  const share = 1 / Math.max(1, items.length);
  return {
    workspaces: 2000,
    days: 90,
    seed: pack.demo.population.seed,
    enrichments: items.map((r) => ({
      id: r.id,
      label: r.label.slice(0, 40),
      step: r.id,
      share,
      rowsMedian: 40,
      outcomes: (r.chargeOnHit ? { done: r.hitRate, "not-found": r2(1 - r.hitRate) } : { done: 0.97, failed: 0.03 }) as Record<string, number>,
      models: r.model && pack.models.some((m) => m.id === r.model) ? [r.model] : [],
      modelSteps: {},
    })),
    outcomes: [
      { id: "done", label: "Done", charged: true },
      { id: "not-found", label: "Not found", charged: false },
      { id: "failed", label: "Failed", charged: false },
    ],
    behaviours: DEFAULT_BEHAVIOURS,
    regions: { us: 0.55, eu: 0.3, in: 0.15 },
    sources: { organic: 0.38, "paid-search": 0.2, referral: 0.16, partner: 0.1, outbound: 0.16 },
  };
}

function pick<T extends string>(weights: Record<T, number>, u: number): T {
  const entries = Object.entries(weights) as [T, number][];
  const total = entries.reduce((s, [, w]) => s + w, 0) || 1;
  let x = u * total;
  for (const [k, w] of entries) {
    if (x < w) return k;
    x -= w;
  }
  return entries[entries.length - 1][0];
}

function poisson(lambda: number, rng: () => number): number {
  const L = Math.exp(-lambda);
  let k = 0;
  let p = 1;
  do {
    k++;
    p *= rng();
  } while (p > L && k < 50);
  return k - 1;
}

const isoDay = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const monthKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
const monthLabel = (d: Date) => d.toLocaleDateString("en-GB", { month: "short", year: "numeric" });

interface EnrichmentModel {
  id: string;
  share: number;
  rowsMedian: number;
  outcomes: [string, number][];
  chargedShare: number;
  models: string[];
  cheapest: string | null;
  /** Rate-card item, credits per row and provider cost per row for each model ("" when no model choice). */
  byModel: Map<string, { item: string; perRow: number; chargeOnHit: boolean; cost: number }>;
}

function compile(pack: TenantPack, cfg: SimConfig): EnrichmentModel[] {
  const prim = primaryMeter(pack).id;
  const charged = new Set(cfg.outcomes.filter((o) => o.charged).map((o) => o.id));
  const modelCost = new Map(pack.models.map((m) => [m.id, m.providerCostPerRun]));
  return cfg.enrichments.map((e) => {
    const outcomes = Object.entries(e.outcomes);
    const chargedShare = outcomes.filter(([o]) => charged.has(o)).reduce((s, [, p]) => s + p, 0);
    const byModel = new Map<string, { item: string; perRow: number; chargeOnHit: boolean; cost: number }>();
    const models = e.models.length ? e.models : [""];
    const baseItem = rateOf(pack, e.step);
    const defaultCost = modelCost.get(e.models[0]) ?? 0;
    for (const m of models) {
      const item = rateOf(pack, e.modelSteps[m] ?? e.step) ?? baseItem;
      if (!item) continue;
      // Without a model-specific rate item, provider cost scales with the model's cost.
      const factor = !e.modelSteps[m] && m && defaultCost > 0 ? (modelCost.get(m) ?? defaultCost) / defaultCost : 1;
      byModel.set(m, { item: item.id, perRow: item.costs[prim] ?? 0, chargeOnHit: item.chargeOnHit, cost: item.providerCost * factor });
    }
    let cheapest: string | null = null;
    for (const m of e.models) {
      const x = byModel.get(m);
      const c = byModel.get(cheapest ?? "");
      if (x && (!c || x.cost + x.perRow < c.cost + c.perRow)) cheapest = m;
    }
    return { id: e.id, share: e.share, rowsMedian: e.rowsMedian, outcomes, chargedShare, models: e.models, cheapest, byModel };
  });
}

function emptyDay(day: number, date: Date): DailyRow {
  return { day, date: isoDay(date), active: 0, signups: 0, churned: 0, runs: 0, rows: 0, credits: 0, byEnrichment: {}, outcomes: {}, modelRuns: {}, providerCost: 0, subsRevenue: 0, topUpRevenue: 0, topUps: 0, blocked: 0 };
}

/**
 * Pure and deterministic: pack + config + anchor (the last window day) → the simulated population.
 * Each workspace draws from its own seeded stream, so changing one behaviour share moves only
 * the workspaces it touches.
 */
export function simulate90(pack: TenantPack, cfg: SimConfig, anchorIso: string): SimOutput {
  const t0 = typeof performance !== "undefined" ? performance.now() : 0;
  const prim = primaryMeter(pack);
  const D = cfg.days;
  const anchor = new Date(anchorIso);
  anchor.setHours(12, 0, 0, 0);
  const windowStart = addDays(anchor, -(D - 1));
  const enr = compile(pack, cfg);
  const enrTotal = enr.reduce((t, e) => t + e.share, 0) || 1;
  const enrCum = enr.map((_, i) => enr.slice(0, i + 1).reduce((t, e) => t + e.share, 0) / enrTotal);
  const pickEnr = (u: number) => enr[Math.min(enr.length - 1, enrCum.findIndex((c) => u < c) >>> 0)];
  // Weekday weight for every simulated day index, from the earliest signup to the window end.
  const weekday = Array.from({ length: HISTORY_DAYS + D }, (_, k) => DEFAULT_WEEKDAY[addDays(windowStart, k - HISTORY_DAYS).getDay()]);
  const profiles = pack.demo.population.profiles;
  const planMix = Object.fromEntries(Object.entries(profiles).map(([id, p]) => [id, p.share])) as Record<string, number>;
  const b = cfg.behaviours;
  const [A, B] = pack.demo.population.names;
  const prepaid = pack.billingModel === "prepaid";
  const daily: DailyRow[] = Array.from({ length: D }, (_, d) => emptyDay(d, addDays(windowStart, d)));
  const modelAgg = new Map<string, ModelUse>();
  const workspaces: WorkspaceSummary[] = [];

  for (let i = 0; i < cfg.workspaces; i++) {
    const rng = mulberry32(parseInt(fnv1a(`${cfg.seed}:${i}`), 16));
    const signupDay = Math.floor(-HISTORY_DAYS + Math.pow(rng(), 0.85) * (HISTORY_DAYS + D));
    const planId = pick(planMix, rng());
    const plan = planOf(pack, planId);
    const region = pick(cfg.regions, rng());
    const source = pick(cfg.sources, rng());
    const fx = SOURCE_EFFECT[source] ?? { churn: 1, neverRun: 1 };
    const paid = plan.paid;
    const neverRun = !paid && rng() < Math.min(1, b.freeNeverRun * fx.neverRun);
    const quiet = !paid && !neverRun && rng() < b.freeGoQuiet;
    const quietAfter = 3 + Math.floor(rng() * 18);
    const churns = paid && rng() < Math.min(1, b.churnAfter3Months * fx.churn);
    const churnAfter = 80 + Math.floor(rng() * 25);
    const topUpper = paid && (prepaid || rng() < b.addTopUps);
    const mu = rng();
    const model: ModelBehaviour = mu < b.switchModels ? "switched" : mu < b.switchModels + b.stayOnDefault ? "default" : "mixed";
    const seats = paid ? 1 + Math.floor(Math.exp(0.9 * Math.abs(normal(rng)))) : 1;
    const prof = profiles[planId];
    const allowance = monthlyAllowance(pack, planId, prim.id);
    const base = prof?.base ?? (allowance || 1);
    const demand = base * Math.exp(Math.log(prof?.median ?? 1) + (prof?.spread ?? 0.5) * normal(rng));
    const activeP = paid ? 0.72 : 0.32;
    const lambda = paid ? 1.5 : 0.7;
    const avgPerRun = enr.reduce((s, e) => {
      const m = model === "switched" && e.cheapest ? e.cheapest : (e.models[0] ?? "");
      const x = e.byModel.get(m) ?? [...e.byModel.values()][0];
      const per = x ? x.perRow * (x.chargeOnHit ? e.chargedShare : 1) : 0;
      return s + e.share * e.rowsMedian * per;
    }, 0);
    const scale = avgPerRun > 0 ? demand / (30 * activeP * lambda * avgPerRun) : 1;
    const rule = grantRule(pack, planId, prim.id);
    const cap = plan.caps.monthlySpend;
    const tierCapped = pack.limits.spend.tierCaps && cap != null;

    let balance = 0;
    let spentCycle = 0;
    let grantedCycle = 0;
    let firstRun: number | null = null;
    let lastActive: number | null = null;
    let status: WorkspaceSummary["status"] = "active";
    const months: (boolean | null)[] = [null, null, null, null];
    let runsW = 0;
    let creditsW = 0;
    let revenueW = 0;
    let topUpsW = 0;
    let blockedW = 0;
    let runsAll = 0;
    const startDay = signupDay;
    if (signupDay >= 0) daily[signupDay].signups++;
    for (let d = startDay; d < D; d++) {
      const tenure = d - signupDay;
      const month = Math.floor(tenure / 30);
      if (month < 4 && months[month] === null) months[month] = false;
      if (churns && tenure >= churnAfter) {
        status = "churned";
        if (d >= 0 && tenure === churnAfter) daily[d].churned++;
        break;
      }
      const inWin = d >= 0;
      // Renewal: bill the plan, close the cycle, grant the allowance.
      if (tenure % 30 === 0) {
        if (paid && !prepaid && plan.price) {
          if (inWin) {
            daily[d].subsRevenue += plan.price;
            revenueW += plan.price;
          }
        }
        const carry = rule.rollover.mode === "full" ? balance : rule.rollover.mode === "capped" ? Math.min(balance, rule.rollover.capX * allowance) : 0;
        balance = Math.max(0, carry);
        spentCycle = 0;
        grantedCycle = 0;
        if (rule.cadence === "monthly" && !(prepaid && !paid && tenure > 0)) balance += plan.included[prim.id] ?? 0;
      }
      if (rule.cadence === "daily") {
        const per = plan.included[prim.id] ?? 0;
        const g = Math.min(per, (rule.monthlyCap ?? Infinity) - grantedCycle);
        if (g > 0) {
          balance += g;
          grantedCycle += g;
        }
      }
      if (neverRun || (quiet && tenure > quietAfter)) continue;
      if (rng() >= Math.min(0.98, activeP * weekday[d + HISTORY_DAYS])) continue;
      const n = poisson(lambda, rng);
      if (!n) continue;
      let ranToday = false;
      for (let k = 0; k < n; k++) {
        const e = pickEnr(rng());
        const choice = e.models.length ? (model === "default" ? e.models[0] : model === "switched" ? (e.cheapest ?? e.models[0]) : rng() < 0.5 ? e.models[0] : (e.cheapest ?? e.models[0])) : "";
        const x = e.byModel.get(choice);
        if (!x) continue;
        let rows = Math.max(1, Math.round(e.rowsMedian * scale * Math.exp(0.5 * normal(rng))));
        const charged = x.chargeOnHit ? e.chargedShare : 1;
        let credits = rows * charged * x.perRow;
        if (tierCapped && spentCycle + credits > cap! + 1e-9) {
          if (inWin) {
            daily[d].blocked++;
            blockedW++;
          }
          continue;
        }
        if (balance < credits - 1e-9) {
          const choicePack = topUpper ? packFor(pack, prim.id, credits - balance) : null;
          if (choicePack) {
            balance += choicePack.pack.units * choicePack.count;
            const price = choicePack.pack.price * choicePack.count;
            if (inWin) {
              daily[d].topUpRevenue += price;
              daily[d].topUps++;
              revenueW += price;
              topUpsW++;
            }
          } else {
            const perRow = credits / rows;
            const fit = perRow > 0 ? Math.floor(balance / perRow + 1e-9) : rows;
            if (inWin) {
              daily[d].blocked++;
              blockedW++;
            }
            if (fit <= 0) continue;
            rows = fit;
            credits = fit * perRow;
          }
        }
        balance -= credits;
        spentCycle += credits;
        ranToday = true;
        runsAll++;
        if (firstRun == null) firstRun = d;
        if (inWin) {
          const day = daily[d];
          day.runs++;
          day.rows += rows;
          day.credits += credits;
          day.byEnrichment[e.id] = (day.byEnrichment[e.id] ?? 0) + credits;
          let left = rows;
          e.outcomes.forEach(([o, p], oi) => {
            const c = oi === e.outcomes.length - 1 ? left : Math.min(left, Math.max(0, Math.round(rows * p + Math.sqrt(rows * p * (1 - p)) * normal(rng))));
            left -= c;
            day.outcomes[o] = (day.outcomes[o] ?? 0) + c;
          });
          const cost = rows * x.cost;
          day.providerCost += cost;
          if (choice) {
            day.modelRuns[choice] = (day.modelRuns[choice] ?? 0) + 1;
            const key = `${e.id}|${choice}`;
            const m = modelAgg.get(key) ?? { enrichment: e.id, model: choice, runs: 0, credits: 0, providerCost: 0, isDefault: choice === e.models[0] };
            m.runs++;
            m.credits += credits;
            m.providerCost += cost;
            modelAgg.set(key, m);
          }
          runsW++;
          creditsW += credits;
        }
      }
      if (ranToday) {
        lastActive = d;
        if (month < 4) months[month] = true;
        if (d >= 0) daily[d].active++;
      }
    }
    const tenureEnd = D - 1 - signupDay;
    if (status !== "churned") {
      if (firstRun == null) status = "never-ran";
      else if (quiet && tenureEnd > quietAfter) status = "quiet";
      else status = lastActive != null && lastActive >= D - QUIET_WINDOW ? "active" : "idle";
    }
    workspaces.push({
      id: `ws-${String(10000 + i)}`,
      name: `${A[i % A.length]} ${B[(i * 7 + Math.floor(i / A.length)) % B.length]}`,
      planId,
      region,
      source,
      signupDay,
      signupDate: isoDay(addDays(windowStart, signupDay)),
      status,
      model,
      topUpper,
      seats,
      tables: firstRun == null ? 0 : Math.min(24, 1 + Math.floor(runsAll / 12)),
      runs: runsW,
      credits: r2(creditsW),
      revenue: r2(revenueW),
      topUps: topUpsW,
      blocked: blockedW,
      firstRunDay: firstRun,
      lastActiveDay: lastActive,
      monthsActive: months,
    });
  }

  for (const day of daily) {
    day.credits = r2(day.credits);
    day.providerCost = r2(day.providerCost);
    day.subsRevenue = r2(day.subsRevenue);
    day.topUpRevenue = r2(day.topUpRevenue);
    for (const k of Object.keys(day.byEnrichment)) day.byEnrichment[k] = r2(day.byEnrichment[k]);
  }
  const models = [...modelAgg.values()].map((m) => ({ ...m, credits: r2(m.credits), providerCost: r2(m.providerCost) }));
  const cohorts = cohortTables(pack, workspaces, windowStart, D);
  const totals = totalsOf(pack, workspaces, daily, models);
  const chats = helpChats(pack, cfg, workspaces, windowStart);
  const ev = evalsFor(pack, cfg, anchor);
  const hash = fnv1a(JSON.stringify({ daily, workspaces, cohorts, totals, models, chats, ev }));
  const ms = typeof performance !== "undefined" ? Math.round(performance.now() - t0) : 0;
  return { packId: pack.id, config: cfg, anchor: isoDay(anchor), windowStart: isoDay(windowStart), daily, workspaces, cohorts, totals, models, chats, skills: ev.skills, suites: ev.suites, evalRuns: ev.runs, hash, ms };
}

function totalsOf(pack: TenantPack, ws: WorkspaceSummary[], daily: DailyRow[], models: ModelUse[]): SimTotals {
  const sum = (f: (d: DailyRow) => number) => r2(daily.reduce((s, d) => s + f(d), 0));
  const choiceRuns = models.reduce((s, m) => s + m.runs, 0);
  return {
    workspaces: ws.length,
    paid: ws.filter((w) => planOf(pack, w.planId).paid).length,
    activeNow: ws.filter((w) => w.status === "active").length,
    churnedInWindow: sum((d) => d.churned),
    neverRan: ws.filter((w) => w.status === "never-ran").length,
    quiet: ws.filter((w) => w.status === "quiet").length,
    runs: sum((d) => d.runs),
    rows: sum((d) => d.rows),
    credits: sum((d) => d.credits),
    providerCost: sum((d) => d.providerCost),
    subsRevenue: sum((d) => d.subsRevenue),
    topUpRevenue: sum((d) => d.topUpRevenue),
    blocked: sum((d) => d.blocked),
    topUpBuyers: ws.filter((w) => w.topUps > 0).length,
    defaultModelShare: choiceRuns ? r2(models.filter((m) => m.isDefault).reduce((s, m) => s + m.runs, 0) / choiceRuns) : 0,
  };
}

export function cohortTables(pack: TenantPack, ws: WorkspaceSummary[], windowStart: Date, D: number): CohortTables {
  const keyOf: Record<CohortDimension, (w: WorkspaceSummary) => [string, string]> = {
    signupMonth: (w) => {
      const d = addDays(windowStart, w.signupDay);
      return [monthKey(d), monthLabel(d)];
    },
    plan: (w) => [w.planId, planOf(pack, w.planId).name],
    region: (w) => [w.region, w.region.toUpperCase()],
    source: (w) => [w.source, w.source.replace(/-/g, " ").replace(/^./, (c) => c.toUpperCase())],
  };
  const out = {} as CohortTables;
  for (const dim of Object.keys(keyOf) as CohortDimension[]) {
    const groups = new Map<string, { label: string; xs: WorkspaceSummary[] }>();
    for (const w of ws) {
      const [k, label] = keyOf[dim](w);
      const g = groups.get(k) ?? { label, xs: [] };
      g.xs.push(w);
      groups.set(k, g);
    }
    const order = dim === "plan" ? pack.plans.map((p) => p.id) : null;
    out[dim] = [...groups.entries()]
      .sort(([a], [b]) => (order ? order.indexOf(a) - order.indexOf(b) : a < b ? -1 : 1))
      .map(([key, g]) => cohortRow(key, g.label, g.xs, D));
  }
  return out;
}

function cohortRow(key: string, label: string, xs: WorkspaceSummary[], D: number): CohortRow {
  const n = xs.length;
  const pct = (f: (w: WorkspaceSummary) => boolean) => (n ? r2(xs.filter(f).length / n) : 0);
  const ret = (k: number) => {
    const eligible = xs.filter((w) => D - 1 - w.signupDay >= (k + 1) * 30 && w.firstRunDay != null);
    return eligible.length ? r2(eligible.filter((w) => w.monthsActive[k] === true).length / eligible.length) : null;
  };
  const revenue = r2(xs.reduce((s, w) => s + w.revenue, 0));
  return {
    key,
    label,
    workspaces: n,
    activatedPct: pct((w) => w.firstRunDay != null),
    activeNowPct: pct((w) => w.status === "active"),
    churnedPct: pct((w) => w.status === "churned"),
    topUpPct: pct((w) => w.topUps > 0),
    switchedPct: pct((w) => w.model === "switched"),
    avgCredits: n ? r2(xs.reduce((s, w) => s + w.credits, 0) / n) : 0,
    revenue,
    arpu: n ? r2(revenue / n / (D / 30)) : 0,
    m1: ret(1),
    m2: ret(2),
    m3: ret(3),
  };
}

const cache = new Map<string, SimOutput>();

/** Memoised `simulate90` for the UI. Checks call `simulate90` directly. */
export function simulateCached(pack: TenantPack, cfg: SimConfig, anchorIso: string): SimOutput {
  const key = `${pack.id}|${fnv1a(JSON.stringify(pack.rateCard) + JSON.stringify(pack.plans) + JSON.stringify(pack.topUpPacks))}|${JSON.stringify(cfg)}|${anchorIso.slice(0, 10)}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const out = simulate90(pack, cfg, anchorIso);
  if (cache.size > 8) cache.delete(cache.keys().next().value as string);
  cache.set(key, out);
  return out;
}
