// Economics: per-account projections, plan fit, cohorts, churn risk, experiment stats and tenant totals.
import type { Plan, TenantPack } from "@/tenants/schema";
import type { Account, Policy } from "@/core/types";
import { accountsFor } from "@/sim/population";
import { CYCLE_DAYS, TODAY_INDEX, median } from "@/core/time";
import {
  freePlan,
  grantRule,
  hasSecondary,
  ladder,
  meterRevenue,
  monthlyAllowance,
  planOf,
  primaryMeter,
  secondaryMeter,
  topUpAllowed,
  topUpUnitPrice,
} from "@/core/pack";

export interface Projection {
  usage: Record<string, number>;
  utilisation: Record<string, number>;
  topUpUnits: Record<string, number>;
  topUpRevenue: number;
  revenue: number;
  breakageUnits: Record<string, number>;
  breakageUsd: number;
  cogs: number;
  capDay: number | null;
  capMeter: string | null;
}

export function project(pack: TenantPack, a: Account, policy: Policy = "today"): Projection {
  const plan = planOf(pack, a.planId);
  const usage: Record<string, number> = {};
  const utilisation: Record<string, number> = {};
  const topUpUnits: Record<string, number> = {};
  const breakageUnits: Record<string, number> = {};
  let topUpRevenue = 0;
  let breakageUsd = 0;
  let capDay: number | null = null;
  let capMeter: string | null = null;
  for (const m of pack.meters) {
    const allow = monthlyAllowance(pack, a.planId, m.id);
    const pool = allow + (a.carry[m.id] ?? 0);
    const d = a.demand[m.id] ?? 0;
    const canTop = topUpAllowed(pack, m.id, plan, policy);
    usage[m.id] = canTop ? d : Math.min(d, pool);
    const utilBase = pack.billingModel === "prepaid" && plan.paid ? (plan.caps.monthlySpend ?? pool) : pool;
    utilisation[m.id] = utilBase > 0 ? d / utilBase : 0;
    topUpUnits[m.id] = Math.max(0, usage[m.id] - pool);
    if (topUpUnits[m.id] > 0) topUpRevenue += topUpUnits[m.id] * topUpUnitPrice(pack, m.id, policy);
    if (d > pool && pool > 0) {
      const cd = (CYCLE_DAYS * pool) / d;
      if (capDay == null || cd < capDay) {
        capDay = cd;
        capMeter = m.id;
      }
    }
    const rule = grantRule(pack, a.planId, m.id);
    const unused = Math.max(0, pool - usage[m.id]);
    const rolled = !plan.paid ? 0 : rule.rollover.mode === "full" ? unused : rule.rollover.mode === "capped" ? Math.min(unused, rule.rollover.capX * allow) : 0;
    breakageUnits[m.id] = unused - rolled;
    if (plan.paid && allow > 0) breakageUsd += breakageUnits[m.id] * (meterRevenue(pack, plan, m.id) / allow);
  }
  const prim = primaryMeter(pack).id;
  const sec = secondaryMeter(pack).id;
  const cogs = (usage[prim] ?? 0) * a.cogsPerUnit + (hasSecondary(pack) ? (usage[sec] ?? 0) * pack.actionCost : 0);
  return { usage, utilisation, topUpUnits, topUpRevenue, revenue: (plan.price ?? 0) + topUpRevenue, breakageUnits, breakageUsd, cogs, capDay, capMeter };
}

export function planCost(pack: TenantPack, a: Pick<Account, "demand" | "needs">, plan: Plan, policy: Policy): number | null {
  if (plan.price == null) return null;
  if (policy === "today" && plan.proposed) return null;
  if (!a.needs.every((f) => plan.features.includes(f))) return null;
  let cost = plan.price;
  let spend = 0;
  for (const m of pack.meters) {
    const d = a.demand[m.id] ?? 0;
    if (m.valueType === "currency") spend += d * m.pricePerUnit;
    const over = d - monthlyAllowance(pack, plan.id, m.id);
    if (over <= 0) continue;
    if (!topUpAllowed(pack, m.id, plan, policy)) return null;
    cost += over * topUpUnitPrice(pack, m.id, policy);
  }
  const cap = plan.caps.monthlySpend;
  if (pack.limits.spend.tierCaps && cap != null && spend > cap) return null;
  return cost;
}

export function bestFit(pack: TenantPack, a: Pick<Account, "demand" | "needs">, policy: Policy): { planId: string; cost: number | null } {
  let best: { planId: string; cost: number } | null = null;
  for (const p of ladder(pack, policy)) {
    const c = planCost(pack, a, p, policy);
    if (c == null) continue;
    if (!best || c < best.cost - 0.005) best = { planId: p.id, cost: c };
  }
  if (best) return best;
  const custom = pack.plans.find((p) => p.price == null);
  return { planId: custom?.id ?? pack.plans[pack.plans.length - 1].id, cost: null };
}

export interface CohortDef {
  id: string;
  label: string;
  test: (a: Account, p: Projection, plan: Plan) => boolean;
}

export function cohortDefs(pack: TenantPack): CohortDef[] {
  const free = freePlan(pack)?.name ?? "Free";
  const prim = primaryMeter(pack);
  const r = pack.rules;
  const prepaid = pack.billingModel === "prepaid";
  const defs: CohortDef[] = [
    { id: "free-capped", label: `${free} · hit a cap this cycle`, test: (a, p, plan) => !plan.paid && p.capDay != null && p.capDay <= TODAY_INDEX },
    { id: "free-active", label: `${free} · under the cap`, test: (a, p, plan) => !plan.paid && (p.capDay == null || p.capDay > TODAY_INDEX) },
    { id: "paid-hot", label: prepaid ? `Paid · above ${r.hotPct}% of tier cap` : `Paid · above ${r.hotPct}% of a meter`, test: (a, p, plan) => plan.paid && Math.max(...Object.values(p.utilisation)) >= r.hotPct / 100 },
    { id: "paid-idle", label: prepaid ? `Paid · under ${r.idlePct}% of tier cap` : `Paid · under ${r.idlePct}% of ${prim.label}`, test: (a, p, plan) => plan.paid && (p.utilisation[prim.id] ?? 0) < r.idlePct / 100 },
    { id: "mcp-first", label: `MCP · ${r.mcpHeavyPct}%+ of runs`, test: (a) => a.mcp >= r.mcpHeavyPct / 100 },
    { id: "payment-failing", label: "Payment failing", test: (a) => a.paymentFailed },
  ];
  if (pack.byokDiscount) defs.splice(4, 0, { id: "byok-heavy", label: `Own keys · ${r.byokHeavyPct}%+ of steps`, test: (a) => a.byok >= r.byokHeavyPct / 100 });
  return defs;
}

export function inCohort(pack: TenantPack, cohortId: string): (a: Account) => boolean {
  const def = cohortDefs(pack).find((c) => c.id === cohortId);
  return (a) => (def ? def.test(a, project(pack, a), planOf(pack, a.planId)) : false);
}

export interface Risk {
  account: Account;
  signals: string[];
  suggested: string;
  mrr: number;
}

export function atRisk(pack: TenantPack, accounts: Account[]): Risk[] {
  const prim = primaryMeter(pack);
  const has = (id: string) => pack.saves.some((s) => s.id === id);
  const pick = (...ids: string[]) => ids.find(has) ?? pack.saves[0]?.id ?? "";
  const out: Risk[] = [];
  for (const a of accounts) {
    const plan = planOf(pack, a.planId);
    if (!plan.paid) continue;
    const p = project(pack, a);
    const signals: string[] = [];
    let suggested = "";
    const drop = a.prev[prim.id] > 0 ? 1 - a.demand[prim.id] / a.prev[prim.id] : 0;
    if (a.paymentFailed) {
      signals.push("Payment failed");
      suggested ||= pick("dunning");
    }
    if (a.cancelIntent) {
      signals.push("Opened cancel");
      suggested ||= pick("pause", "bonus");
    }
    if (drop >= pack.rules.usageDropPct / 100) {
      signals.push(`Usage down ${Math.round(drop * 100)}%`);
      suggested ||= pick("bonus");
    }
    if ((p.utilisation[prim.id] ?? 0) < pack.rules.idlePct / 100) {
      signals.push(`Using ${Math.round((p.utilisation[prim.id] ?? 0) * 100)}% of ${pack.billingModel === "prepaid" ? "tier cap" : prim.label}`);
      suggested ||= pick("downgrade");
    }
    if (signals.length) out.push({ account: a, signals, suggested, mrr: p.revenue });
  }
  return out.sort((x, y) => y.signals.length - x.signals.length || y.mrr - x.mrr);
}

function erf(x: number): number {
  const s = Math.sign(x);
  const ax = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * ax);
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-ax * ax);
  return s * y;
}

export function compareArms(c: { exposed: number; converted: number }, v: { exposed: number; converted: number }) {
  if (!c.exposed || !v.exposed) return null;
  const p1 = c.converted / c.exposed;
  const p2 = v.converted / v.exposed;
  const pool = (c.converted + v.converted) / (c.exposed + v.exposed);
  const se = Math.sqrt(pool * (1 - pool) * (1 / c.exposed + 1 / v.exposed));
  const z = se > 0 ? (p2 - p1) / se : 0;
  const pValue = 2 * (1 - 0.5 * (1 + erf(Math.abs(z) / Math.SQRT2)));
  const seDiff = Math.sqrt((p1 * (1 - p1)) / c.exposed + (p2 * (1 - p2)) / v.exposed);
  return { p1, p2, lift: p1 > 0 ? (p2 - p1) / p1 : 0, pValue, ciLow: p2 - p1 - 1.96 * seDiff, ciHigh: p2 - p1 + 1.96 * seDiff };
}

export interface WorkbenchStats {
  accounts: Account[];
  projections: Map<string, Projection>;
  paid: Account[];
  freeCapped: Account[];
  firstCapShare: Record<string, number>;
  todayGap: number | null;
  cockpitGap: number;
  mrr: number;
  breakageUsd: number;
  marginPerUnit: number;
  marginPct: number;
  byokForgone: number;
  failingMrr: number;
  failing: number;
}

const statsCache = new WeakMap<TenantPack, WorkbenchStats>();

export function workbenchStats(pack: TenantPack): WorkbenchStats {
  const hit = statsCache.get(pack);
  if (hit) return hit;
  const accounts = accountsFor(pack);
  const prim = primaryMeter(pack);
  const projections = new Map<string, Projection>();
  for (const a of accounts) projections.set(a.id, project(pack, a));
  const paid = accounts.filter((a) => planOf(pack, a.planId).paid);
  const freeCapped = accounts.filter(inCohort(pack, "free-capped"));
  const firstCapShare: Record<string, number> = {};
  for (const a of freeCapped) {
    const m = projections.get(a.id)?.capMeter ?? prim.id;
    firstCapShare[m] = (firstCapShare[m] ?? 0) + 1 / Math.max(1, freeCapped.length);
  }
  const todayCosts = freeCapped.map((a) => bestFit(pack, a, "today").cost).filter((c): c is number => c != null);
  const cockpitCosts = freeCapped.map((a) => bestFit(pack, a, "cockpit").cost).filter((c): c is number => c != null);
  let mrr = 0;
  let breakageUsd = 0;
  let primRevenue = 0;
  let primCogs = 0;
  let primUnits = 0;
  let byokForgone = 0;
  let failingMrr = 0;
  const unit = topUpUnitPrice(pack, prim.id);
  for (const a of paid) {
    const p = projections.get(a.id)!;
    const plan = planOf(pack, a.planId);
    mrr += p.revenue;
    breakageUsd += p.breakageUsd;
    primRevenue +=
      pack.billingModel === "prepaid"
        ? (p.usage[prim.id] ?? 0) * prim.pricePerUnit
        : meterRevenue(pack, plan, prim.id) + (p.topUpUnits[prim.id] ?? 0) * (Number.isFinite(unit) ? unit : prim.pricePerUnit);
    primCogs += (p.usage[prim.id] ?? 0) * a.cogsPerUnit;
    primUnits += p.usage[prim.id] ?? 0;
    if (pack.byokDiscount) {
      const share = Math.min(a.byok, 0.9);
      byokForgone += (((a.demand[prim.id] ?? 0) * share) / (1 - share)) * prim.pricePerUnit * (pack.byokDiscount.pct / 100);
    }
    if (a.paymentFailed) failingMrr += p.revenue;
  }
  const result: WorkbenchStats = {
    accounts,
    projections,
    paid,
    freeCapped,
    firstCapShare,
    todayGap: todayCosts.length ? median(todayCosts) : null,
    cockpitGap: median(cockpitCosts),
    mrr,
    breakageUsd,
    marginPerUnit: primUnits > 0 ? (primRevenue - primCogs) / primUnits : 0,
    marginPct: primRevenue > 0 ? (primRevenue - primCogs) / primRevenue : 0,
    byokForgone,
    failingMrr,
    failing: paid.filter((a) => a.paymentFailed).length,
  };
  statsCache.set(pack, result);
  return result;
}
