// Loads every region pack under ./regions at runtime and validates it.
import { parseRegion, type RegionPack } from "@/tenants/region-schema";

const files = import.meta.glob("./regions/*.json", { eager: true, import: "default" }) as Record<string, unknown>;
const ORDER = ["us", "eu", "in"];

export const REGION_LOAD = Object.entries(files).map(([file, json]) => {
  const r = parseRegion(json);
  return { file: file.replace("./", ""), region: r.ok ? r.region : null, issues: r.ok ? [] : r.issues };
});

export const REGIONS: RegionPack[] = REGION_LOAD.flatMap((l) => (l.region ? [l.region] : [])).sort((a, b) => ORDER.indexOf(a.id) - ORDER.indexOf(b.id));

export function regionById(id: string | undefined): RegionPack {
  return REGIONS.find((r) => r.id === id) ?? REGIONS[0];
}
