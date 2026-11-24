// Loads every pack under ./packs at runtime and validates it against the schema.
// A pack that fails validation is kept out of the switcher and its issues are shown in the Brain.
import { parsePack, type PackIssue, type TenantPack } from "@/tenants/schema";

const files = import.meta.glob("./packs/*.json", { eager: true, import: "default" }) as Record<string, unknown>;
const ORDER = ["clay", "builderco", "apico", "seatco"];

export interface LoadedPack {
  file: string;
  pack: TenantPack | null;
  issues: PackIssue[];
}

export const PACK_LOAD: LoadedPack[] = Object.entries(files).map(([file, json]) => {
  const r = parsePack(json);
  return r.ok ? { file: file.replace("./", ""), pack: r.pack, issues: [] } : { file: file.replace("./", ""), pack: null, issues: r.issues };
});

const rank = (id: string) => (ORDER.includes(id) ? ORDER.indexOf(id) : ORDER.length);
export const TENANT_PACKS: TenantPack[] = PACK_LOAD.flatMap((l) => (l.pack ? [l.pack] : [])).sort((a, b) => rank(a.id) - rank(b.id));

export function builtInPack(id: string): TenantPack | null {
  return TENANT_PACKS.find((p) => p.id === id) ?? null;
}

export function packById(id: string): TenantPack {
  return builtInPack(id) ?? TENANT_PACKS[0];
}
