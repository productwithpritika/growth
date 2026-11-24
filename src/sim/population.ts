// Deterministic population of tenant accounts, generated from the pack's demo profiles.
import type { TenantPack } from "@/tenants/schema";
import type { Account } from "@/core/types";
import { mulberry32, normal } from "@/core/time";
import { grantRule, hasSecondary, monthlyAllowance, planOf, primaryMeter, secondaryMeter } from "@/core/pack";

const cache = new Map<string, Account[]>();

export function accountsFor(pack: TenantPack): Account[] {
  const pop = pack.demo.population;
  const key = `${pack.id}:${pop.seed}:${pop.size}:${Object.keys(pop.profiles).join(",")}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const rng = mulberry32(pop.seed);
  const [A, B] = pop.names;
  const prim = primaryMeter(pack);
  const sec = hasSecondary(pack) ? secondaryMeter(pack) : null;
  const currency = prim.valueType === "currency";
  const round = (v: number) => (currency ? Math.round(v * 100) / 100 : Math.round(v));
  const profiles = Object.entries(pop.profiles);
  const out: Account[] = [];
  for (let i = 0; i < pop.size; i++) {
    let pick = rng();
    let planId = profiles[0][0];
    for (const [id, pr] of profiles) {
      if (pick < pr.share) {
        planId = id;
        break;
      }
      pick -= pr.share;
    }
    const prof = pop.profiles[planId];
    const plan = planOf(pack, planId);
    const base = prof.base ?? (monthlyAllowance(pack, planId, prim.id) || 1);
    const ratio = Math.exp(Math.log(prof.median) + prof.spread * normal(rng));
    const demand: Record<string, number> = { [prim.id]: round(ratio * base) };
    if (sec) demand[sec.id] = Math.round(ratio * prof.secondary * Math.exp(0.35 * normal(rng)) * (monthlyAllowance(pack, planId, sec.id) || base));
    const ids = sec ? [prim.id, sec.id] : [prim.id];
    const prev: Record<string, number> = {};
    for (const m of ids) prev[m] = round(demand[m] * Math.exp(0.2 * normal(rng)));
    if (rng() < 0.08) for (const m of ids) demand[m] = round(prev[m] * (0.15 + 0.3 * rng()));
    const carry: Record<string, number> = {};
    for (const m of pack.meters) {
      const rule = grantRule(pack, planId, m.id);
      const allow = monthlyAllowance(pack, planId, m.id) || base;
      carry[m.id] = plan.paid && rule.rollover.mode !== "none" ? round(rng() * (pack.billingModel === "prepaid" ? 0.5 : 0.6) * allow) : 0;
    }
    const needs = Object.entries(prof.needs).filter(([, p]) => rng() < p).map(([f]) => f);
    const byok = pack.byokDiscount ? (rng() < 0.14 ? 0.5 + 0.35 * rng() : 0.15 * rng()) : 0;
    const mcp = rng() < 0.18 ? 0.5 + 0.4 * rng() : 0.2 * rng();
    out.push({
      id: `ws-${String(1000 + i)}`,
      name: `${A[i % A.length]} ${B[(i + Math.floor(i / A.length)) % B.length]}`,
      planId,
      demand,
      prev,
      carry,
      units: Math.round(demand[prim.id] * pop.unitsPerPrimary * (0.8 + 0.4 * rng())),
      signupWeek: Math.floor(rng() * 12),
      needs,
      byok,
      mcp,
      paymentFailed: plan.paid && rng() < 0.035,
      cancelIntent: plan.paid && rng() < 0.045,
      cogsPerUnit: pop.cogsPerUnit * (0.8 + 0.4 * rng()),
    });
  }
  cache.set(key, out);
  return out;
}
