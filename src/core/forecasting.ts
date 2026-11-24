// Forecasting: a meter's cycle timeline with a weekday-weighted run-out forecast and 80% band,
// scheduled grants and plan-fit demand. The maths lives in core/forecast.ts as pure functions.
import type { Workflow } from "@/tenants/schema";
import type { Account, TenantState } from "@/core/types";
import { balanceOf, consumption, expiringWithin, heldOf, holdsOf } from "@/core/ledger";
import { CYCLE_DAYS, addDays, cycleOf, dayIndexOf, r2 } from "@/core/time";
import { expectedRunCost } from "@/core/metering";
import { grantRule, isScheduled, personaOf, planOf, rateOf } from "@/core/pack";
import { forecastRunOut, type Confidence } from "@/core/forecast";

export interface TimelinePoint {
  day: number;
  label: string;
  used: number | null;
  projected: number | null;
  band: [number, number] | null;
  available: number;
}

export interface MeterTimeline {
  points: TimelinePoint[];
  used: number;
  available: number;
  balance: number;
  held: number;
  expiring: { amount: number; firstAt: string | null };
  /** Weekday-neutral daily burn from the trailing 7 days. */
  rate: number;
  sd: number;
  /** Sunday-first weekday weights the projection uses. */
  weights: number[];
  confidence: Confidence;
  runsOutDay: number | null;
  runsOutEarly: number | null;
  runsOutLate: number | null;
  ranOutAt: string | null;
}

export function meterTimeline(t: TenantState, account: string, meterId: string): MeterTimeline {
  const { start, day } = cycleOf(t);
  const startMs = start.getTime();
  const all = t.ledger.filter((e) => e.account === account && e.meter === meterId);
  const before = all.filter((e) => new Date(e.ts).getTime() < startMs);
  const opening = before.length ? before[before.length - 1].balance : 0;
  const entries = all.filter((e) => new Date(e.ts).getTime() >= startMs);
  const usedByDay = new Array<number>(CYCLE_DAYS + 1).fill(0);
  const addByDay = new Array<number>(CYCLE_DAYS + 1).fill(0);
  let granted = 0;
  // Open holds are shown as held, not used; the projection starts from used + held.
  const open = new Set(holdsOf(all, account).filter((h) => h.status === "open").map((h) => h.holdId));
  const held = heldOf(all, account, meterId);
  for (const e of entries) {
    if (e.kind === "hold" && e.holdId && open.has(e.holdId)) continue;
    const d = Math.min(CYCLE_DAYS, Math.max(0, dayIndexOf(e.ts, start)));
    const c = consumption(e);
    if (c !== 0) usedByDay[d] += c;
    else addByDay[d] += e.amount;
    if (e.kind === "grant" && e.source === "plan") granted += e.amount;
  }
  addByDay[0] += opening;
  // Future grants a daily rule will still post this cycle.
  const hub = t.hub[account];
  const plan = hub ? planOf(t.pack, hub.planId) : null;
  const rule = plan ? grantRule(t.pack, plan.id, meterId) : null;
  const perDay = rule?.cadence === "daily" && plan ? (plan.included[meterId] ?? 0) : 0;
  const cap = rule?.monthlyCap ?? Infinity;

  const points: TimelinePoint[] = [];
  let cumUsed = 0;
  let cumAvail = 0;
  for (let d = 0; d <= day; d++) {
    cumAvail += addByDay[d];
    cumUsed += usedByDay[d];
    const label = addDays(start, d).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
    const base = r2(cumUsed + (d === day ? held : 0));
    points.push({ day: d, label, used: r2(cumUsed), projected: d === day ? base : null, band: d === day ? [base, base] : null, available: r2(cumAvail) });
  }
  const history = usedByDay.slice(0, day).map((used, d) => ({ dow: addDays(start, d).getDay(), used }));
  let future = 0;
  const inflow = (n: number) => {
    const d = day + n;
    if (perDay > 0 && d < CYCLE_DAYS && granted + future + perDay <= cap + 1e-9) {
      future += perDay;
      return perDay;
    }
    return 0;
  };
  const fc = forecastRunOut({ history, balance: r2(cumAvail - cumUsed - held), todayDow: addDays(start, day).getDay(), horizon: CYCLE_DAYS - day, inflow });
  for (const f of fc.days) {
    const d = day + f.offset;
    const avail = cumUsed + held + f.available;
    const from = cumUsed + held;
    points.push({
      day: d,
      label: addDays(start, d).toLocaleDateString("en-GB", { day: "numeric", month: "short" }),
      used: null,
      projected: r2(Math.min(avail, from + f.cumMid)),
      band: [r2(Math.min(avail, from + f.cumLo)), r2(Math.min(avail, from + f.cumHi))],
      available: r2(avail),
    });
  }
  let runsOutDay = fc.runOut.mid != null ? day + fc.runOut.mid : null;
  let runsOutEarly = fc.runOut.early != null ? day + fc.runOut.early : null;
  let runsOutLate = fc.runOut.late != null ? day + fc.runOut.late : null;

  const credits = entries.filter((e) => e.amount > 0 && consumption(e) === 0);
  const lastCredit = credits[credits.length - 1];
  const creditEventSeq = lastCredit?.eventId ? Number(lastCredit.eventId.slice(4)) : 0;
  const ran = t.events.find(
    (e) =>
      e.account === account &&
      (e.status === "stopped" || e.status === "blocked") &&
      e.limitedBy === meterId &&
      new Date(e.ts).getTime() >= startMs &&
      (!lastCredit || e.ts > lastCredit.ts || (e.ts === lastCredit.ts && e.seq > creditEventSeq)),
  );
  const balance = balanceOf(t.ledger, account, meterId);
  if (ran) {
    runsOutDay = null;
    runsOutEarly = null;
    runsOutLate = null;
  } else if (balance <= 0.005 && fc.base > 0) {
    // Empty with nothing blocked yet: it runs out today, not tomorrow.
    runsOutDay = day;
    runsOutEarly = day;
    runsOutLate = day;
  }
  return {
    points,
    used: r2(cumUsed),
    available: r2(points[day]?.available ?? cumAvail),
    balance,
    held,
    expiring: expiringWithin(t, account, meterId, t.pack.rules.expiringSoonDays),
    rate: fc.base,
    sd: fc.sd,
    weights: fc.weights,
    confidence: fc.confidence,
    runsOutDay,
    runsOutEarly,
    runsOutLate,
    ranOutAt: ran ? ran.ts : null,
  };
}

export function runsPerCycle(t: TenantState, w: Workflow): number {
  const { start } = cycleOf(t);
  let n = 0;
  for (let d = 0; d < CYCLE_DAYS; d++) if (isScheduled(w, start, d)) n++;
  return n;
}

export function personaAsAccount(t: TenantState, personaId: string): Account {
  const persona = personaOf(t.pack, personaId);
  const demand: Record<string, number> = {};
  const needs = new Set<string>();
  for (const w of persona.workflows) {
    const c = expectedRunCost(t.pack, w);
    const n = runsPerCycle(t, w);
    for (const [m, v] of Object.entries(c)) demand[m] = r2((demand[m] ?? 0) + v * n);
    for (const step of w.steps) {
      const req = rateOf(t.pack, step)?.requires;
      if (req) needs.add(req);
    }
  }
  return {
    id: persona.id,
    name: persona.name,
    planId: t.hub[personaId]?.planId ?? persona.planId,
    demand,
    prev: demand,
    carry: { ...persona.carryIn },
    units: 0,
    signupWeek: 0,
    needs: [...needs],
    byok: 0,
    mcp: 0,
    paymentFailed: false,
    cancelIntent: false,
    cogsPerUnit: t.pack.demo.population.cogsPerUnit,
  };
}

export function nextRun(t: TenantState, personaId: string): { workflow: Workflow; day: number } | null {
  const { start, day } = cycleOf(t);
  const persona = personaOf(t.pack, personaId);
  for (let d = day; d < CYCLE_DAYS; d++) {
    const w = persona.workflows.find((x) => isScheduled(x, start, d));
    if (w) return { workflow: w, day: d };
  }
  return null;
}
