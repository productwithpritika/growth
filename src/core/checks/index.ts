// Every acceptance suite, in report order. The Brain's Checks tab and tests/acceptance.test.ts both run these.
import type { TenantPack } from "@/tenants/schema";
import type { RegionPack } from "@/tenants/region-schema";
import type { Suite } from "@/core/checks/harness";
import { ledgerSuite } from "@/core/checks/ledger-checks";
import { forecastSuite, regionSuite, simSuite, tenantSuite } from "@/core/checks/other-checks";

export * from "@/core/checks/harness";
export { surfaceModel } from "@/core/checks/other-checks";

export function acceptanceSuites(packs: TenantPack[], regions: RegionPack[], anchor: string): Suite[] {
  return [ledgerSuite(packs), forecastSuite(), simSuite(packs, anchor), tenantSuite(packs), regionSuite(regions)];
}
