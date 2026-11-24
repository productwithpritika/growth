// A dry run of a pack before it is loaded: seeds it in memory and reads the headline numbers.
import type { TenantPack } from "@/tenants/schema";
import { seedTenant } from "@/sim/seed";
import { workbenchStats } from "@/core/economics";
import { meterTimeline } from "@/core/forecasting";

export interface PackPreview {
  accounts: number;
  paid: number;
  freeCapped: number;
  mrr: number;
  marginPct: number;
  breakageUsd: number;
  maya: string;
  dev: string;
}

export function previewPack(pack: TenantPack): PackPreview {
  const s = seedTenant(pack, new Date().toISOString(), true);
  const w = workbenchStats(pack);
  const line = (id: "maya" | "dev") =>
    pack.meters
      .map((m) => {
        const tl = meterTimeline(s, id, m.id);
        return `${m.label} ${tl.ranOutAt ? "ran out" : tl.runsOutDay != null ? "runs out early" : "lasts the cycle"}`;
      })
      .join(", ");
  return { accounts: w.accounts.length, paid: w.paid.length, freeCapped: w.freeCapped.length, mrr: Math.round(w.mrr), marginPct: w.marginPct, breakageUsd: Math.round(w.breakageUsd), maya: line("maya"), dev: line("dev") };
}
