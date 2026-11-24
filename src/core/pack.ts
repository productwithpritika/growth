// Reads over a Tenant Pack: lookups, grant rules, top-up pricing and schedules.
import type { GrantRule, Meter, Plan, RateItem, TenantPack, TopUpPack, Workflow } from "@/tenants/schema";
import type { HubPersonaId } from "@/tenants/personas";
import type { Policy } from "@/core/types";
import { addDays } from "@/core/time";

export const primaryMeter = (pack: TenantPack): Meter => pack.meters[0];
export const secondaryMeter = (pack: TenantPack): Meter => pack.meters[1] ?? pack.meters[0];
export const hasSecondary = (pack: TenantPack): boolean => pack.meters.length > 1;

export function planOf(pack: TenantPack, id: string): Plan {
  return pack.plans.find((p) => p.id === id) ?? pack.plans[0];
}
export function freePlan(pack: TenantPack): Plan | undefined {
  return pack.plans.find((p) => !p.paid);
}
export function meterOf(pack: TenantPack, id: string): Meter {
  return pack.meters.find((m) => m.id === id) ?? pack.meters[0];
}
export function rateOf(pack: TenantPack, id: string): RateItem | undefined {
  return pack.rateCard.find((r) => r.id === id);
}

export interface HubPersona {
  id: HubPersonaId;
  name: string;
  planId: string;
  role: string;
  blurb: string;
  seats: number;
  carryIn: Record<string, number>;
  expiredAtStart: Record<string, number>;
  card: TenantPack["demo"]["hub"]["maya"]["card"];
  autoTopUp: TenantPack["demo"]["hub"]["maya"]["autoTopUp"];
  topUpCap: number;
  workflows: Workflow[];
  inFlight: string | null;
  region: string;
}

export function personaOf(pack: TenantPack, id: string): HubPersona {
  const key: HubPersonaId = id === "dev" ? "dev" : "maya";
  return { id: key, name: key === "dev" ? "Dev" : "Maya", ...pack.demo.hub[key] };
}

/** The grant rule for a plan and meter: the plan's own rule, else the "*" rule. */
export function grantRule(pack: TenantPack, planId: string, meterId: string): GrantRule {
  return (
    pack.grantRules.find((g) => g.plan === planId && g.meter === meterId) ??
    pack.grantRules.find((g) => g.plan === "*" && g.meter === meterId) ?? {
      plan: "*",
      meter: meterId,
      cadence: "monthly",
      monthlyCap: null,
      rollover: { mode: "none", capX: 1 },
      expiryDays: null,
    }
  );
}

/** What a plan grants for a meter across a whole cycle (daily grants up to their monthly cap). */
export function monthlyAllowance(pack: TenantPack, planId: string, meterId: string, days = 30): number {
  const plan = planOf(pack, planId);
  const rule = grantRule(pack, planId, meterId);
  const per = plan.included[meterId] ?? 0;
  if (rule.cadence === "daily") return Math.min(per * days, rule.monthlyCap ?? Infinity);
  return per;
}

/**
 * The share of a plan's price that pays for one meter. Uses the pack's meterPrice when set;
 * otherwise splits the price across meters by the list value of what the plan includes.
 */
export function meterRevenue(pack: TenantPack, plan: Plan, meterId: string): number {
  const set = plan.meterPrice[meterId];
  if (set != null) return set;
  if (!plan.price) return 0;
  const value = (id: string) => monthlyAllowance(pack, plan.id, id) * meterOf(pack, id).pricePerUnit;
  const total = pack.meters.reduce((s, m) => s + value(m.id), 0);
  return total > 0 ? (plan.price * value(meterId)) / total : meterId === pack.meters[0].id ? plan.price : 0;
}

export function packsFor(pack: TenantPack, meterId: string, policy: Policy = "cockpit"): TopUpPack[] {
  return pack.topUpPacks.filter((t) => t.meter === meterId && !(policy === "today" && t.proposed)).sort((a, b) => a.units - b.units);
}

/** Cheapest price per unit among the packs a policy allows; Infinity when there are none. */
export function topUpUnitPrice(pack: TenantPack, meterId: string, policy: Policy = "cockpit"): number {
  const ps = packsFor(pack, meterId, policy);
  return ps.length ? Math.min(...ps.map((p) => p.price / p.units)) : Infinity;
}

export function topUpPremiumPct(pack: TenantPack, meterId: string, policy: Policy = "cockpit"): number {
  const m = meterOf(pack, meterId);
  const u = topUpUnitPrice(pack, meterId, policy);
  return m.pricePerUnit > 0 && Number.isFinite(u) ? Math.round((u / m.pricePerUnit - 1) * 100) : 0;
}

export function topUpAllowed(pack: TenantPack, meterId: string, plan: Plan, policy: Policy): boolean {
  if (!packsFor(pack, meterId, policy).length) return false;
  if (pack.billingModel === "prepaid") return true;
  return !(policy === "today" && !plan.paid);
}

/** The pack that covers `units` most cheaply: the smallest that covers it, else the largest repeated. */
export function packFor(pack: TenantPack, meterId: string, units: number, policy: Policy = "cockpit"): { pack: TopUpPack; count: number } | null {
  const ps = packsFor(pack, meterId, policy);
  if (!ps.length) return null;
  const fit = ps.find((p) => p.units >= units);
  if (fit) return { pack: fit, count: 1 };
  const big = ps[ps.length - 1];
  return { pack: big, count: Math.ceil(units / big.units) };
}

export function ladder(pack: TenantPack, policy: Policy): Plan[] {
  return pack.plans.filter((p) => !(policy === "today" && p.proposed));
}

export function isScheduled(w: Workflow, start: Date, day: number): boolean {
  if (w.every === "day") return true;
  if (w.every === "week") return day % 7 === (w.offset ?? 0);
  const dow = addDays(start, day).getDay();
  return dow !== 0 && dow !== 6;
}

export function copy(pack: TenantPack, key: string, fallback: string): string {
  return pack.copy[key] ?? fallback;
}

/** "Data Credit", "Credit", "$1" — what one unit is called in sentences. */
export function unitNoun(m: Meter): string {
  return m.valueType === "currency" ? "$1 of usage" : m.label.replace(/s$/, "");
}
