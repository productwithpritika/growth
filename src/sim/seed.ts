// Usage simulator: seeds a tenant's current cycle from its pack, then moves the
// demo clock forward a day at a time, including renewal at the end of a cycle.
import type { TenantPack } from "@/tenants/schema";
import { initGrowth, stepGrowth } from "@/growth/state";
import { initPlatform, stepPlatform } from "@/platform/state";
import { HUB_PERSONAS, memberPersona } from "@/tenants/personas";
import type { Experiment, HubAccountState, SpendLimit, TableRun, TenantState } from "@/core/types";
import { Book, expireLots, placeHold as placeLedgerHold, renew as renewLedger } from "@/core/ledger";
import { CYCLE_DAYS, DAY_MS, addDays, cycleOf, fnv1a, mulberry32 } from "@/core/time";
import { executeRun, expectedRunCost, type Ctx } from "@/core/metering";
import { policyOf, settleOpenHolds } from "@/core/actions";
import { freePlan, grantRule, isScheduled, monthlyAllowance, personaOf, planOf, primaryMeter, rateOf, type HubPersona } from "@/core/pack";
import { memberIdOfOwner, seedTeam } from "@/core/team";
import { advanceDunning, NO_DUNNING, startDunning } from "@/core/dunning";
import { advanceInCtx, resumeWaiting } from "@/core/table-run";
import { cloneForSim } from "@/sim/util";

function initialHub(pack: TenantPack, p: HubPersona, start: Date): HubAccountState {
  const demo = pack.demo.hub[p.id];
  const alerts: Record<string, boolean> = {};
  for (const pct of pack.rules.alertPcts) alerts[String(pct)] = pct >= 80;
  const budgets: Record<string, number | null> = {};
  for (const w of p.workflows) budgets[w.id] = null;
  return {
    planId: p.planId,
    nextPlanId: null,
    status: "active",
    cancelReason: null,
    card: { ...p.card },
    autoTopUp: { ...p.autoTopUp },
    autoTopUpHalted: false,
    topUpCap: p.topUpCap,
    budgets,
    mcpCap: null,
    alerts,
    alertsSent: [],
    rewards: [],
    charges: [],
    dismissed: {},
    region: p.region ?? "us",
    consents: p.autoTopUp.enabled ? { [p.region ?? "us"]: { at: new Date(0).toISOString(), maxPerCharge: null } } : {},
    backupCard: demo.backupCard ? { ...demo.backupCard } : null,
    team: seedTeam(pack, p.id),
    limits: seedLimits(pack, p.id),
    requests: [],
    audit: [],
    notices: [],
    alertChannels: { email: true, chat: p.id === "dev", inapp: true },
    runs: [],
    dunning: { ...NO_DUNNING, attempts: [] },
    planChange: null,
    rewardState: { sparkDays: [], sparkGranted: [], badges: [], activatedAt: addDays(start, -60).toISOString(), domainVerified: true, refused: [] },
    lifecycle: { signedUpAt: addDays(start, p.id === "maya" ? -75 : -420).toISOString(), nudges: [], optOut: false, convertedAt: planOf(pack, p.planId).paid ? addDays(start, -400).toISOString() : null },
    shares: [],
    profile: {
      company: p.id === "dev" ? `${demo.domain.split(".")[0].replace(/^./, (c) => c.toUpperCase())}` : "Maya (sole trader)",
      address: p.id === "dev" ? { line1: "500 Howard Street, Floor 4", city: "San Francisco, CA", postcode: "94105", country: "United States" } : { line1: "2150 Mission Street", city: "San Francisco, CA", postcode: "94110", country: "United States" },
      taxId: null,
      email: `${p.id === "dev" ? "billing" : "maya"}@${demo.domain}`,
      coupons: [],
      billing: "monthly",
      addOns: {},
    },
    pause: null,
    capAsk: null,
  };
}

/** Earlier plan invoices for paid accounts, so Billing has history like today's portal. */
function pastInvoices(pack: TenantPack, p: HubPersona, start: Date): HubAccountState["charges"] {
  const plan = planOf(pack, p.planId);
  if (!plan.paid || !plan.price) return [];
  return [2, 1, 0].map((k) => ({ id: `ch_inv_past_${k}_${p.id}`, ts: addDays(start, -CYCLE_DAYS * k).toISOString(), amount: plan.price ?? 0, description: `${plan.name} plan`, status: "paid" as const }));
}

/** Starting limits: the Member persona near a blocking limit, and a workspace warning above the allowance. */
function seedLimits(pack: TenantPack, id: "maya" | "dev"): SpendLimit[] {
  if (id !== "dev") return [];
  const prim = primaryMeter(pack).id;
  const demo = pack.demo.hub.dev;
  const member = memberPersona(pack).id;
  const out: SpendLimit[] = [];
  const mine = demo.workflows.filter((w) => memberIdOfOwner(w.owner) === member);
  const perCycle = mine.reduce((s, w) => s + (expectedRunCost(pack, w)[prim] ?? 0) * (w.every === "week" ? 4 : w.every === "weekday" ? 21 : 30), 0);
  if (perCycle > 0) {
    const nice = (n: number) => { const mag = 10 ** Math.max(0, Math.floor(Math.log10(n)) - 1); return Math.max(mag, Math.round(n / mag) * mag); };
    out.push({ id: `lim_member_${member}`, scope: "member", target: member, meter: prim, amount: nice(perCycle * 0.9), behaviour: "block" });
  }
  const allowance = monthlyAllowance(pack, demo.planId, prim) + (demo.carryIn[prim] ?? 0);
  if (allowance > 0) out.push({ id: "lim_workspace", scope: "workspace", target: "workspace", meter: prim, amount: Math.round(allowance * 1.5), behaviour: "warn" });
  return out;
}

function grantExpiry(pack: TenantPack, planId: string, meter: string, ts: string, cycleEnd: Date): string | null {
  const rule = grantRule(pack, planId, meter);
  if (rule.expiryDays) return addDays(new Date(ts), rule.expiryDays).toISOString();
  return rule.rollover.mode === "none" ? cycleEnd.toISOString() : null;
}

function postMonthlyGrants(book: Book, pack: TenantPack, p: HubPersona, planId: string, ts: string, cycleEnd: Date, eventId: string, addOns: Record<string, number> = {}) {
  const plan = planOf(pack, planId);
  for (const m of pack.meters) {
    const rule = grantRule(pack, planId, m.id);
    const amt = (plan.included[m.id] ?? 0) + (pack.hub.expansion[m.id]?.step ?? 0) * (addOns[m.id] ?? 0);
    if (rule.cadence === "monthly" && amt > 0) {
      book.post({ ts, account: p.id, meter: m.id, kind: "grant", source: "plan", amount: amt, reason: "plan.monthly", actor: "system:renewal", eventId, note: `${plan.name} monthly allowance`, expiresAt: grantExpiry(pack, planId, m.id, ts, cycleEnd), idempotencyKey: `grant:${p.id}:${m.id}:${ts}` });
    }
  }
}

function grantedThisCycle(book: Book, account: string, meter: string, start: Date): number {
  return book.ledger.filter((e) => e.account === account && e.meter === meter && e.kind === "grant" && e.source === "plan" && new Date(e.ts).getTime() >= start.getTime()).reduce((s, e) => s + e.amount, 0);
}

function postDailyGrants(book: Book, pack: TenantPack, p: HubPersona, planId: string, ts: string, start: Date, cycleEnd: Date) {
  const plan = planOf(pack, planId);
  for (const m of pack.meters) {
    const rule = grantRule(pack, planId, m.id);
    const per = plan.included[m.id] ?? 0;
    if (rule.cadence !== "daily" || per <= 0) continue;
    const already = grantedThisCycle(book, p.id, m.id, start);
    const amt = Math.min(per, (rule.monthlyCap ?? Infinity) - already);
    if (amt <= 0) continue;
    book.post({ ts, account: p.id, meter: m.id, kind: "grant", source: "plan", amount: amt, reason: "plan.daily", actor: "system:scheduler", eventId: null, note: `${plan.name} daily grant`, expiresAt: grantExpiry(pack, planId, m.id, ts, cycleEnd), idempotencyKey: `grant:${p.id}:${m.id}:${ts}` });
  }
}

function runsOn(pack: TenantPack, start: Date, d: number) {
  const runs: { ts: number; p: HubPersona; wi: number }[] = [];
  HUB_PERSONAS.forEach((id, pi) => {
    const p = personaOf(pack, id);
    p.workflows.forEach((w, wi) => {
      if (isScheduled(w, start, d)) runs.push({ ts: start.getTime() + d * DAY_MS + (8 + wi * 2 + pi) * 3_600_000, p, wi });
    });
  });
  return runs.sort((a, b) => a.ts - b.ts);
}

function placeHold(ctx: Ctx, ts: string) {
  const w = ctx.persona.workflows.find((x) => x.id === ctx.persona.inFlight);
  if (!w) return;
  const holdId = `hold:${w.id}:${ts.slice(0, 10)}`;
  const need = expectedRunCost(ctx.pack, w);
  const ev = ctx.book.event({ ts, account: ctx.persona.id, type: "run.started", workflow: w.name, channel: w.channel, units: w.units, status: "info", note: "In flight · credits held until it finishes" });
  for (const [m, v] of Object.entries(need)) {
    const amt = Math.min(v, ctx.book.spendable(ctx.persona.id, m));
    if (amt > 0) placeLedgerHold(ctx.book, { ts, account: ctx.persona.id, meter: m, amount: amt, holdId, actor: "system:scheduler", eventId: ev.id, note: `${w.name} · in flight` });
  }
}

export function seedTenant(pack: TenantPack, clockIso: string, custom = false): TenantState {
  const { start, end, day } = cycleOf(clockIso);
  const book = new Book([], [], policyOf(pack));
  const hub: Record<string, HubAccountState> = {};
  const rng = mulberry32(pack.demo.population.seed + 17);
  const t0 = new Date(start.getTime() + 5 * 60_000).toISOString();
  for (const id of HUB_PERSONAS) {
    const p = personaOf(pack, id);
    hub[id] = initialHub(pack, p, start);
    hub[id].charges.push(...pastInvoices(pack, p, start));
    const plan = planOf(pack, p.planId);
    const ev = book.event({ ts: t0, account: id, type: "cycle.started", status: "info", note: `${plan.name} cycle started` });
    for (const m of pack.meters) {
      const carry = p.carryIn[m.id] ?? 0;
      const expired = p.expiredAtStart[m.id] ?? 0;
      if (carry + expired > 0) {
        const lot = book.post({ ts: t0, account: id, meter: m.id, kind: "rollover", source: "rollover", amount: carry + expired, reason: "rollover.opening", actor: "system:renewal", eventId: ev.id, note: "Balance carried from last cycle" });
        if (expired > 0) book.post({ ts: t0, account: id, meter: m.id, kind: "expiry", amount: -expired, reason: "expiry.cycle-close", actor: "system:renewal", eventId: ev.id, note: `Over the rollover cap · ${grantRule(pack, p.planId, m.id).rollover.mode}`, lotId: lot.id });
      }
    }
    postMonthlyGrants(book, pack, p, p.planId, t0, end, ev.id);
  }
  const ctxFor = (p: HubPersona): Ctx => ({ pack, persona: p, hub: hub[p.id], book, rng, cycleStart: start, actor: "system:scheduler" });
  for (let d = 0; d <= day; d++) {
    const g = new Date(start.getTime() + d * DAY_MS + 5 * 60_000).toISOString();
    for (const id of HUB_PERSONAS) postDailyGrants(book, pack, personaOf(pack, id), hub[id].planId, g, start, end);
    if (d === day) break;
    for (const r of runsOn(pack, start, d)) executeRun(ctxFor(r.p), r.p.workflows[r.wi], new Date(r.ts).toISOString());
  }
  const holdTs = new Date(new Date(clockIso).getTime() - 40 * 60_000).toISOString();
  for (const id of HUB_PERSONAS) placeHold(ctxFor(personaOf(pack, id)), holdTs);
  for (const id of HUB_PERSONAS) seedPausedRun(pack, book.events, hub[id], id, start);
  const clock = new Date(clockIso);
  const experiments: Experiment[] = pack.demo.experiments.map(({ startedDaysAgo, ...e }) => ({
    ...e,
    arms: e.arms.map((a) => ({ ...a })),
    startedAt: startedDaysAgo != null ? addDays(clock, -startedDaysAgo).toISOString() : null,
  }));
  const base = {
    packId: pack.id,
    custom,
    clock: clockIso,
    cycleStart: start.toISOString(),
    cycleNo: 1,
    tick: 0,
    pack: cloneForSim(pack),
    ledger: book.ledger,
    events: book.events,
    hub,
    experiments,
    saves: {},
    approvals: [],
    exitSurveys: [],
  };
  return { ...base, growth: initGrowth(base, clockIso), platform: initPlatform(pack, clockIso) };
}

/** A table run that stopped for credits earlier this cycle shows up as a paused run the user can resume. */
function seedPausedRun(pack: TenantPack, events: TenantState["events"], h: HubAccountState, id: "maya" | "dev", start: Date) {
  const e = [...events].reverse().find((x) => x.account === id && x.type === "usage" && x.status === "stopped" && x.channel === "Table" && x.reason?.code === "insufficient_balance" && (x.done ?? 0) > 0 && new Date(x.ts) >= start);
  if (!e) return;
  const item = pack.rateCard.find((r) => r.label === e.step);
  const w = pack.demo.hub[id].workflows.find((x) => x.name === e.workflow);
  if (!item || !w || w.steps.length !== 1) return;
  const found = e.found ?? e.done ?? 0;
  const run: TableRun = {
    id: `run_seed_${id}_${fnv1a(e.id).slice(0, 4)}`,
    tableId: w.id,
    table: w.name,
    stepId: item.id,
    column: item.label,
    byok: item.byok,
    rows: e.units ?? w.units,
    done: e.done ?? 0,
    found,
    verified: e.verified ?? 0,
    notFound: (e.done ?? 0) - found,
    retries: e.retries ?? 0,
    status: "paused",
    holdId: null,
    held: {},
    drawn: {},
    used: { ...(e.meters ?? {}) },
    released: {},
    member: e.member ?? memberIdOfOwner(w.owner),
    startedAt: e.ts,
    updatedAt: e.ts,
    pausedReason: e.reason ?? null,
    resumeAt: null,
    segments: 1,
    warnings: [],
  };
  if (rateOf(pack, run.stepId)) h.runs.push(run);
}

function renewCycle(book: Book, s: TenantState, hub: Record<string, HubAccountState>, at: Date): Date {
  const pack = s.pack;
  const ts = at.toISOString();
  const newEnd = addDays(at, CYCLE_DAYS);
  for (const id of HUB_PERSONAS) {
    const p = personaOf(pack, id);
    const h = hub[id];
    const ev = book.event({ ts, account: id, type: "cycle.renewed", status: "info", note: `Cycle ${s.cycleNo + 1} started` });
    const stillPaused = h.status === "paused" && !!h.pause && new Date(h.pause.until).getTime() > at.getTime();
    const frozen = stillPaused && h.pause?.policy === "freeze";
    // A frozen pause keeps every lot exactly as it was; otherwise the cycle closes under the rollover rules.
    if (!frozen) {
      for (const m of pack.meters) {
        const rule = grantRule(pack, h.planId, m.id);
        renewLedger(book, { ts, account: id, meter: m.id, mode: rule.rollover.mode, capX: rule.rollover.capX, allowance: monthlyAllowance(pack, h.planId, m.id), rolloverExpiresAt: rule.expiryDays ? addDays(at, rule.expiryDays).toISOString() : null, eventId: ev.id });
      }
    }
    if (stillPaused) {
      h.alertsSent = [];
      h.dismissed = {};
      book.event({ ts, account: id, type: "subscription.still_paused", status: "info", note: `Paused until ${new Date(h.pause!.until).toLocaleDateString("en-GB", { day: "numeric", month: "short" })} · no charge, no new allowance` });
      continue;
    }
    if (h.status === "cancelling") {
      h.planId = freePlan(pack)?.id ?? h.planId;
      book.event({ ts, account: id, type: "subscription.cancelled", status: "info", note: `Moved to ${planOf(pack, h.planId).name}` });
    } else if (h.nextPlanId) {
      h.planId = h.nextPlanId;
    }
    h.status = "active";
    h.pause = null;
    h.nextPlanId = null;
    h.alertsSent = [];
    h.autoTopUpHalted = false;
    h.capAsk = null;
    h.dismissed = {};
    const plan = planOf(pack, h.planId);
    if ((plan.price ?? 0) > 0) {
      let amount = plan.price ?? 0;
      for (const [m, n] of Object.entries(h.profile.addOns)) amount += (pack.hub.expansion[m]?.price ?? 0) * n;
      const coupon = h.profile.coupons.find((c) => at.getTime() < addDays(new Date(c.appliedAt), c.months * CYCLE_DAYS).getTime());
      if (coupon) amount *= 1 - coupon.pctOff / 100;
      const annual = h.profile.billing === "annual";
      const invoiceId = `ch_inv_${s.cycleNo + 1}_${id}`;
      h.charges.push({ id: invoiceId, ts, amount: annual ? 0 : Math.round(amount * 100) / 100, description: `${plan.name} plan${annual ? " · covered by the annual term" : ""}${coupon && !annual ? ` · ${coupon.code}` : ""}`, status: annual ? "paid" : "failed" });
      if (!annual) startDunning({ pack, persona: personaOf(pack, id), hub: h, book, rng: () => 0.5, cycleStart: at, actor: "system:renewal" }, ts, invoiceId, Math.round(amount * 100) / 100);
    }
    postMonthlyGrants(book, pack, { ...p, planId: h.planId }, h.planId, new Date(at.getTime() + 5 * 60_000).toISOString(), newEnd, ev.id, h.profile.addOns);
  }
  return at;
}

/** Move the demo clock forward one day: settle in-flight runs, run today's schedule, renew at cycle end, post daily grants. */
export function advanceDay(s: TenantState): TenantState {
  const pack = s.pack;
  const { start, day, end } = cycleOf(s);
  const book = new Book(s.ledger, s.events, policyOf(pack));
  const hub: Record<string, HubAccountState> = JSON.parse(JSON.stringify(s.hub));
  const rng = mulberry32(s.tick + 1234);
  const ctxFor = (id: string, cycleStart: Date): Ctx => ({ pack, persona: personaOf(pack, id), hub: hub[id], book, rng, cycleStart, actor: "system:scheduler" });
  const clock = new Date(s.clock);
  // Holds placed before now finish first: each run draws on its hold and the difference is released.
  const settleTs = new Date(clock.getTime() + 30 * 60_000).toISOString();
  for (const id of HUB_PERSONAS) {
    const ctx = ctxFor(id, start);
    settleOpenHolds(ctx, settleTs);
    // Table runs still going finish before the day turns.
    for (const r of hub[id].runs) if (r.status === "running") advanceInCtx(ctx, settleTs, r.id, r.rows);
    advanceDunning(ctx, settleTs);
  }
  for (const r of runsOn(pack, start, day)) {
    if (r.ts <= clock.getTime()) continue;
    executeRun(ctxFor(r.p.id, start), r.p.workflows[r.wi], new Date(r.ts).toISOString());
  }
  let cycleStart = start;
  let cycleNo = s.cycleNo;
  if (day + 1 >= CYCLE_DAYS) {
    cycleStart = renewCycle(book, s, hub, end);
    cycleNo += 1;
    const after = new Date(end.getTime() + 10 * 60_000).toISOString();
    for (const id of HUB_PERSONAS) resumeWaiting(ctxFor(id, cycleStart), after);
  }
  const nextDay = Math.round((addDays(clock, 1).getTime() - cycleStart.getTime()) / DAY_MS);
  const g = new Date(cycleStart.getTime() + Math.max(0, Math.floor(nextDay)) * DAY_MS + 5 * 60_000).toISOString();
  const cycleEnd = addDays(cycleStart, CYCLE_DAYS);
  // Lots whose own expiry date has passed (rewards, promos, dated top-ups) expire as the day turns.
  for (const id of HUB_PERSONAS) for (const m of pack.meters) expireLots(book, id, m.id, g);
  for (const id of HUB_PERSONAS) postDailyGrants(book, pack, personaOf(pack, id), hub[id].planId, g, cycleStart, cycleEnd);
  book.event({ ts: addDays(clock, 1).toISOString(), account: "tenant", type: "sim.day_advanced", status: "info", note: `Clock moved to ${addDays(clock, 1).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}` });
  return stepPlatform(stepGrowth({ ...s, clock: addDays(clock, 1).toISOString(), cycleStart: cycleStart.toISOString(), cycleNo, tick: 0, ledger: book.ledger, events: book.events, hub }));
}
