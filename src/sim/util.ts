import type { TenantPack } from "@/tenants/schema";

export function cloneForSim(pack: TenantPack): TenantPack {
  return JSON.parse(JSON.stringify(pack)) as TenantPack;
}
