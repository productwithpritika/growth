import type { TenantPack } from "@/tenants/schema";
import { monthlyAllowance } from "@/core/pack";
export { addDays, fnv1a, mulberry32 } from "@/core/time";

export function monthlyAllowanceSafe(pack: TenantPack, planId: string, meterId: string, fallback: number): number {
  return monthlyAllowance(pack, planId, meterId) || fallback;
}
