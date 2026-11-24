// Pseudo-locale (Phase 8 §8.6): stretches the pack's display strings by about 40% with accented
// letters, so layouts can be checked for long translations without a translation file.
import type { TenantPack } from "@/tenants/schema";

const MAP: Record<string, string> = { a: "á", e: "é", i: "í", o: "ö", u: "ü", c: "ç", n: "ñ", s: "š", y: "ý", A: "Å", E: "É", I: "Î", O: "Ø", U: "Ü", C: "Ç", N: "Ñ", S: "Š" };

export function pseudo(s: string): string {
  if (!s || s.includes("{")) return s;
  const body = s.replace(/[A-Za-z]/g, (ch) => MAP[ch] ?? ch);
  const pad = "·".repeat(Math.max(2, Math.round(s.length * 0.4)));
  return `[${body} ${pad}]`;
}

const cache = new WeakMap<TenantPack, TenantPack>();

/** The same pack with every name, label and copy string pseudo-localised. Memoised per pack. */
export function pseudoPack(pack: TenantPack): TenantPack {
  const hit = cache.get(pack);
  if (hit) return hit;
  const p: TenantPack = {
    ...pack,
    company: pseudo(pack.company).slice(0, 60),
    workUnit: { one: pseudo(pack.workUnit.one), many: pseudo(pack.workUnit.many) },
    brand: { ...pack.brand, wordmark: pseudo(pack.brand.wordmark) },
    meters: pack.meters.map((m) => ({ ...m, label: pseudo(m.label), hint: pseudo(m.hint) })),
    plans: pack.plans.map((pl) => ({ ...pl, name: pseudo(pl.name), highlights: pl.highlights.map(pseudo) })),
    rewards: pack.rewards.map((r) => ({ ...r, label: pseudo(r.label) })),
    copy: Object.fromEntries(Object.entries(pack.copy).map(([k, v]) => [k, pseudo(v)])),
    rateCard: pack.rateCard.map((r) => ({ ...r, label: pseudo(r.label) })),
  };
  cache.set(pack, p);
  return p;
}
