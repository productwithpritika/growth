// Pack Builder and Pack lint (Phase 8 §8.1). Pick an archetype, edit meters, grants, rollover,
// top-ups, limits and rewards, and the Credits Hub preview reconfigures from the draft pack.
// Lint flags risky configurations before a pack can be loaded.
import type { TenantPack } from "@/tenants/schema";

export type Archetype = NonNullable<TenantPack["archetype"]>;

export const ARCHETYPES: { id: Archetype; label: string; base: string; blurb: string }[] = [
  { id: "hybrid-credits", label: "Credits plus actions", base: "clay", blurb: "Two meters: data credits for marketplace data and actions for every step (Clay)." },
  { id: "subscription-credits", label: "Subscription with credits", base: "builderco", blurb: "One credit balance included in each plan, top-ups on the side (BuilderCo)." },
  { id: "prepaid-usage", label: "Prepaid usage", base: "apico", blurb: "A dollar balance drawn down at list price, tiers unlock higher spend (APICo)." },
  { id: "seat-plus-usage", label: "Seats plus a credit pool", base: "seatco", blurb: "Per-seat plans; every seat adds credits to one shared pool (SeatCo)." },
];

export interface BuilderDraft {
  archetype: Archetype;
  company: string;
  meters: { id: string; label: string; price: number }[];
  plans: { id: string; name: string; price: number | null; included: number; paid: boolean }[];
  rollover: { mode: "none" | "capped" | "full"; capX: number };
  expiryDays: number | null;
  topUps: { units: number; price: number }[];
  allowNegative: boolean;
  overdraftCap: number;
  selfSetCap: boolean;
  rewards: { label: string; amount: number }[];
  taxDisplay: Record<string, boolean>;
}

const paidRule = (pack: TenantPack) => pack.grantRules.find((g) => g.plan === "*" && g.meter === pack.meters[0].id) ?? pack.grantRules.find((g) => pack.plans.find((p) => p.id === g.plan)?.paid) ?? pack.grantRules[0];

export function draftFromPack(pack: TenantPack, archetype?: Archetype): BuilderDraft {
  const prim = pack.meters[0].id;
  const rule = paidRule(pack);
  return {
    archetype: archetype ?? pack.archetype ?? "subscription-credits",
    company: pack.company,
    meters: pack.meters.map((m) => ({ id: m.id, label: m.label, price: m.pricePerUnit })),
    plans: pack.plans.filter((p) => !p.proposed).map((p) => ({ id: p.id, name: p.name, price: p.price, included: p.included[prim] ?? 0, paid: p.paid })),
    rollover: { mode: rule.rollover.mode, capX: rule.rollover.capX ?? 1 },
    expiryDays: rule.expiryDays ?? null,
    topUps: pack.topUpPacks.filter((t) => t.meter === prim && !t.proposed).map((t) => ({ units: t.units, price: t.price })),
    allowNegative: pack.ledgerPolicy.allowNegative,
    overdraftCap: pack.ledgerPolicy.overdraft,
    selfSetCap: pack.limits.spend.selfSetCap,
    rewards: pack.rewards.map((r) => ({ label: r.label, amount: r.amount })),
    taxDisplay: Object.fromEntries(pack.regions.map((r) => [r.id, pack.taxDisplay?.[r.id] !== false])),
  };
}

export const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 30) || "tenant";

/** Apply a draft to a copy of the base pack. The result still goes through the pack schema. */
export function packFromDraft(base: TenantPack, d: BuilderDraft, id?: string): TenantPack {
  const p = JSON.parse(JSON.stringify(base)) as TenantPack;
  const prim = p.meters[0].id;
  p.id = id ?? p.id;
  p.company = d.company.trim().slice(0, 40) || p.company;
  p.brand = { ...p.brand, wordmark: p.company.slice(0, 30), glyph: p.company.slice(0, 1).toUpperCase() || p.brand.glyph };
  p.archetype = d.archetype;
  for (const m of p.meters) {
    const x = d.meters.find((y) => y.id === m.id);
    if (x) {
      m.label = x.label.trim().slice(0, 40) || m.label;
      m.pricePerUnit = Math.max(0, x.price);
    }
  }
  for (const pl of p.plans) {
    const x = d.plans.find((y) => y.id === pl.id);
    if (!x) continue;
    pl.name = x.name.trim().slice(0, 40) || pl.name;
    pl.price = x.price == null ? null : Math.max(0, x.price);
    pl.included = { ...pl.included, [prim]: Math.max(0, x.included) };
  }
  for (const g of p.grantRules) {
    const paid = g.plan === "*" || p.plans.find((x) => x.id === g.plan)?.paid;
    if (!paid || g.meter !== prim) continue;
    g.rollover = { mode: d.rollover.mode, capX: Math.max(0, d.rollover.capX) };
    g.expiryDays = d.expiryDays == null || d.expiryDays <= 0 ? null : Math.round(d.expiryDays);
  }
  p.topUpPacks = [...p.topUpPacks.filter((t) => t.meter !== prim), ...d.topUps.filter((t) => t.units > 0).map((t) => ({ id: `${prim}-${Math.round(t.units)}`, meter: prim, units: Math.round(t.units), price: Math.max(0, t.price), validityDays: 365, proposed: false }))];
  p.ledgerPolicy = { allowNegative: d.allowNegative, overdraft: Math.max(0, d.overdraftCap) };
  p.limits = { ...p.limits, spend: { ...p.limits.spend, selfSetCap: d.selfSetCap } };
  p.rewards = p.rewards.map((r, i) => (d.rewards[i] ? { ...r, label: d.rewards[i].label.trim() || r.label, amount: Math.max(1, d.rewards[i].amount) } : r));
  p.taxDisplay = Object.fromEntries(Object.entries(d.taxDisplay).filter(([, v]) => v === false));
  return p;
}

export interface LintIssue {
  id: "expiry-rollover" | "negative-uncapped" | "tax-display" | "reward-breakage";
  level: "error" | "warn";
  text: string;
  path: string;
}

const UNUSED: Record<string, number> = { none: 0.22, capped: 0.1, full: 0.03 };

/** Expected monthly breakage per paid account on the entry plan, in units of the primary meter. */
export function breakagePerAccount(pack: TenantPack): number {
  const prim = pack.meters[0].id;
  const entry = pack.plans.find((p) => p.paid && !p.proposed && (p.included[prim] ?? 0) > 0);
  if (!entry) return 0;
  const rule = pack.grantRules.find((g) => g.plan === entry.id && g.meter === prim) ?? pack.grantRules.find((g) => g.plan === "*" && g.meter === prim);
  return Math.round((entry.included[prim] ?? 0) * (UNUSED[rule?.rollover.mode ?? "none"] ?? 0.1));
}

/** Monthly reward credits one account can earn at most. */
export function rewardCapPerAccount(pack: TenantPack): number {
  const prim = pack.meters[0].id;
  const spark = pack.hub.spark.meter == null || pack.hub.spark.meter === prim ? pack.hub.spark.monthlyCap : 0;
  return pack.rewards.filter((r) => r.meter === prim).reduce((s, r) => s + r.amount, 0) + spark;
}

/** Risky configurations. `regionPacks` lists the region ids that have tax and consent rules. */
export function lintPack(pack: TenantPack, regionPacks: string[]): LintIssue[] {
  const out: LintIssue[] = [];
  pack.grantRules.forEach((g, i) => {
    if (g.rollover.mode === "none" || g.expiryDays == null) return;
    const window = g.rollover.mode === "full" ? 60 : 30 * Math.max(1, g.rollover.capX);
    if (g.expiryDays < window) out.push({ id: "expiry-rollover", level: "error", text: `${g.plan === "*" ? "Paid plans" : pack.plans.find((p) => p.id === g.plan)?.name ?? g.plan}: credits roll over for ${g.rollover.mode === "full" ? "every cycle" : `up to ${g.rollover.capX}× a cycle`} but expire after ${g.expiryDays} days, so rollover is promised and then taken away.`, path: `grantRules.${i}` });
  });
  if (pack.ledgerPolicy.allowNegative && pack.ledgerPolicy.overdraft <= 0) out.push({ id: "negative-uncapped", level: "error", text: "Balances may go negative with no overdraft cap: one runaway agent can run up an unbounded bill.", path: "ledgerPolicy" });
  for (const r of pack.regions) {
    if (!regionPacks.includes(r.id)) out.push({ id: "tax-display", level: "error", text: `${r.name} is a billed region with no tax display rules, so prices there would show without the local tax.`, path: `regions.${r.id}` });
    else if (pack.taxDisplay?.[r.id] === false) out.push({ id: "tax-display", level: "error", text: `Tax display is switched off for ${r.name}.`, path: `taxDisplay.${r.id}` });
  }
  const cap = rewardCapPerAccount(pack);
  const brk = breakagePerAccount(pack);
  if (brk > 0 && cap > brk) out.push({ id: "reward-breakage", level: "warn", text: `Rewards can pay out ${cap.toLocaleString("en-US")} ${pack.meters[0].label} a month per account, more than the ${brk.toLocaleString("en-US")} forecast to go unused. Rewards would cost real margin, not breakage.`, path: "rewards" });
  return out;
}
