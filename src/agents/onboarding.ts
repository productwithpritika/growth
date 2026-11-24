// Agentic onboarding: turns a short brief into a validated Tenant Pack.
// The model drafts the commercial model (meters, plans, grants, top-ups). Everything
// else is deterministic and labelled as a tool step: demo scaffolding, schema
// validation, the first-month simulation, risk and diff for the approval sheet.
import type { PackIssue, TenantPack } from "@/tenants/schema";
import { builtInPack } from "@/tenants/registry";
import type { PackPreview } from "@/sim/preview";
import type { DiffRow } from "@/ui/approval-sheet";
import { fnv1a } from "@/core/time";
import { fmtUsd } from "@/core/format";

export interface OnboardBrief {
  company: string;
  description: string;
  /** Which shipped pack the model sees as its worked example. */
  pattern: "builderco" | "clay" | "apico";
}

export const PATTERNS: { id: OnboardBrief["pattern"]; label: string; hint: string }[] = [
  { id: "builderco", label: "One credit balance", hint: "Daily or monthly grants, rollover, top-ups that last a year" },
  { id: "clay", label: "Two meters", hint: "Separate data and action meters that expand on their own" },
  { id: "apico", label: "Prepaid balance", hint: "Dollar balance, auto-reload, usage tiers by deposit" },
];

export const EXAMPLE_BRIEF: OnboardBrief = {
  company: "Lumen Studio",
  description:
    "AI video generation for marketing teams. Every render costs credits: a 10-second draft is 1 credit, a 1080p final is 4, 4K is 10. Free gets 3 credits a day up to 40 a month. Creator is $29 for 300 credits, Team is $99 for 1,200 credits and unused credits roll over one month. Teams can buy 500-credit packs that last 6 months.",
  pattern: "builderco",
};

export type OnboardStepId = "read" | "draft" | "scaffold" | "validate" | "repair" | "simulate" | "approve";

export const ONBOARD_STEPS: { id: OnboardStepId; label: string; by: "agent" | "tool" | "you" }[] = [
  { id: "read", label: "Read the brief and an example pack", by: "tool" },
  { id: "draft", label: "Draft meters, plans, grants and top-ups", by: "agent" },
  { id: "scaffold", label: "Add personas and a customer population", by: "tool" },
  { id: "validate", label: "Validate against the Tenant Pack schema", by: "tool" },
  { id: "repair", label: "Fix what validation found", by: "agent" },
  { id: "simulate", label: "Simulate a first month", by: "tool" },
  { id: "approve", label: "Wait for a person to approve", by: "you" },
];

/** A built-in pack without its demo section: what the model sees as a worked example. */
export function examplePack(id: OnboardBrief["pattern"]): Record<string, unknown> {
  const p = builtInPack(id);
  if (!p) return {};
  const rest: Record<string, unknown> = { ...p };
  delete rest.demo;
  return rest;
}

export function slugId(company: string): string {
  const s = company
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return s || "tenant";
}

const SECTIONS =
  "id, company, category, billingModel, workUnit, brand, meters, plans, grantRules, topUpPacks, autoTopUp, limits, byokDiscount, expansion, rewards, moments, models, regions, compliance, copy, rateCard, actionCost, saves, rules, agents";

export function draftPrompt(brief: OnboardBrief): string {
  const example = JSON.stringify(examplePack(brief.pattern));
  return [
    "You configure Chargebee's Monetization Cockpit for a new AI-native company.",
    "Write a Tenant Pack as one JSON object and nothing else: no prose, no comments.",
    `Top-level keys, exactly: ${SECTIONS}. Do NOT include a "demo" key.`,
    "Rules:",
    `- id must be "${slugId(brief.company)}"; company "${brief.company}".`,
    "- ids are lowercase a-z, 0-9 and hyphens, at most 40 characters.",
    "- meters: 1 to 3. valueType is credits, actions or currency. pricePerUnit is the list price in USD.",
    "- plans: price in USD per month (null for custom/enterprise); included is the grant per cadence for each meter id.",
    "- grantRules: one per plan and meter or plan \"*\" as the fallback; cadence monthly or daily (daily may set monthlyCap); rollover.mode none, capped (with capX) or full; expiryDays or null.",
    "- topUpPacks: units and price in USD, validityDays or null.",
    "- rateCard: what each action costs per work unit in each meter (costs keyed by meter id) and the provider's cost in USD.",
    "- brand accent colours are oklch(L C H) or #rrggbb. Keep copy values under 160 characters.",
    "- Use only facts in the brief for prices and allowances. Where the brief is silent, follow the example's structure.",
    "",
    `Brief for ${brief.company}:`,
    brief.description.trim(),
    "",
    "Worked example (a different company, same schema):",
    example,
  ].join("\n");
}

export function repairPrompt(brief: OnboardBrief, json: string, issues: PackIssue[]): string {
  return [
    `This Tenant Pack draft for ${brief.company} failed schema validation.`,
    "Return the corrected pack as one JSON object and nothing else. Keep every value the issues don't mention. Do not include a \"demo\" key.",
    "",
    "Issues:",
    ...issues.slice(0, 20).map((i) => `- ${i.path}: ${i.message}`),
    "",
    "Draft:",
    json,
  ].join("\n");
}

type Obj = Record<string, unknown>;
const isObj = (x: unknown): x is Obj => typeof x === "object" && x !== null && !Array.isArray(x);
const arr = (x: unknown): Obj[] => (Array.isArray(x) ? x.filter(isObj) : []);
const num = (x: unknown, d = 0) => (typeof x === "number" && Number.isFinite(x) ? x : d);
const str = (x: unknown, d = "") => (typeof x === "string" ? x : d);

/**
 * Deterministic scaffolding (a tool step, no model): adds the demo section the
 * cockpit needs to show the pack (Maya, Dev, Nia, Sam and a sample population)
 * and fills operational sections the draft left out from the example pack.
 * Returns the names of everything it filled so the narrator can say so.
 */
export function scaffold(draft: unknown, brief: OnboardBrief): { pack: Obj; filled: string[] } {
  const example = examplePack(brief.pattern);
  const p: Obj = isObj(draft) ? { ...draft } : {};
  const filled: string[] = [];
  delete p.demo;
  p.id = slugId(brief.company);
  p.company = str(p.company, brief.company) || brief.company;
  for (const k of ["workUnit", "brand", "autoTopUp", "limits", "rules", "agents"] as const) {
    if (!isObj(p[k])) {
      p[k] = structuredClone(example[k]);
      filled.push(k);
    }
  }
  if (isObj(p.brand)) {
    const b = p.brand as Obj;
    if (!b.wordmark) b.wordmark = brief.company.slice(0, 30);
    if (!b.glyph) b.glyph = brief.company.slice(0, 1).toUpperCase();
  }

  const meters = arr(p.meters);
  const plans = arr(p.plans);
  const rates = arr(p.rateCard);
  const grants = arr(p.grantRules);
  const prepaid = p.billingModel === "prepaid";
  const m0 = meters[0];
  const m0id = str(m0?.id, "credits");
  const packs = arr(p.topUpPacks).filter((t) => t.meter === m0id);
  const smallest = packs.map((t) => num(t.units)).filter((u) => u > 0).sort((a, b) => a - b)[0];

  const ruleFor = (planId: string) => grants.find((g) => g.plan === planId && g.meter === m0id) ?? grants.find((g) => g.plan === "*" && g.meter === m0id);
  const allowance = (pl: Obj | undefined) => {
    if (!pl) return 0;
    const per = num(isObj(pl.included) ? (pl.included as Obj)[m0id] : 0);
    const g = ruleFor(str(pl.id));
    if (g?.cadence === "daily") return Math.min(per * 30, num(g.monthlyCap, Infinity));
    return per;
  };
  const priced = plans.filter((pl) => pl.price !== null && !pl.proposed);
  const free = priced.find((pl) => pl.paid === false) ?? priced[0] ?? plans[0];
  const paid = [...priced].filter((pl) => pl.paid === true).sort((a, b) => num(a.price) - num(b.price));
  const devPlan = paid[Math.min(1, paid.length - 1)] ?? free;

  // Work units: cost of one unit of the cheapest-but-real action in the primary meter.
  const real = rates.filter((r) => num(isObj(r.costs) ? (r.costs as Obj)[m0id] : 0) > 0);
  const r0 = real[0] ?? rates[0];
  const r1 = real[1] ?? r0;
  const cost = (r: Obj | undefined) => Math.max(0.0001, num(isObj(r?.costs) ? (r!.costs as Obj)[m0id] : 0, 1) * (r?.chargeOnHit ? num(r.hitRate, 1) : 1));
  const freeAllow = allowance(free) || (prepaid ? 5 : 30);
  const devAllow = allowance(devPlan) || num(isObj(devPlan?.caps) ? (devPlan!.caps as Obj).monthlySpend : 0, 200) * 0.4 || 200;
  const mayaUnits = Math.max(1, Math.ceil((freeAllow * 1.35) / 22 / cost(r0)));
  const devUnits = Math.max(1, Math.ceil((devAllow * 0.7) / 22 / cost(r0)));
  const agentUnits = Math.max(1, Math.ceil((devAllow * 0.35) / 30 / cost(r1)));
  const card = (brand: string, last4: string): Obj => ({ brand, last4, expires: "09/29", status: "ok" });
  const auto = (enabled: boolean, units: number): Obj => ({ enabled, meter: m0id, threshold: Math.round(units * 0.4 * 100) / 100, units });

  const profiles: Obj = {};
  const tiers = priced.length ? priced : plans.slice(0, 1);
  const shares = tiers.map((pl, i) => (i === 0 ? 0.62 : 0.38 / Math.max(1, tiers.length - 1)));
  tiers.forEach((pl, i) => {
    const allow = allowance(pl);
    const spendCap = num(isObj(pl.caps) ? (pl.caps as Obj).monthlySpend : 0);
    profiles[str(pl.id)] = {
      share: Math.round(shares[i] * 1000) / 1000,
      median: pl.paid === false ? 1 : 0.75,
      spread: 0.6,
      ...(allow > 0 ? {} : { base: Math.max(1, spendCap * 0.35 || 50) }),
    };
  });
  const r0Cost = cost(r0);
  const cogs = rates.length ? rates.reduce((s, r) => s + num(r.providerCost) / Math.max(0.0001, cost(r)), 0) / rates.length : 0.05;

  p.demo = {
    hub: {
      maya: {
        planId: str(free?.id, "free"),
        role: "Founder",
        blurb: `Trying ${brief.company} for a side project`,
        seats: 1,
        carryIn: {},
        expiredAtStart: {},
        card: card("Visa", "4417"),
        autoTopUp: auto(false, smallest ?? Math.max(1, Math.round(freeAllow / 2))),
        topUpCap: 25,
        workflows: [{ id: "weeknights", name: `Weeknight ${str((p.workUnit as Obj)?.many, "runs")}`, owner: "Maya", every: "weekday", offset: 0, units: mayaUnits, steps: [str(r0?.id, "run")], channel: "Table" }],
        inFlight: null,
      },
      dev: {
        planId: str(devPlan?.id, "free"),
        role: "Head of operations",
        blurb: "Owns the bill for a six-seat team",
        seats: 6,
        carryIn: {},
        expiredAtStart: {},
        card: card("Mastercard", "5521"),
        autoTopUp: auto(true, smallest ?? Math.max(1, Math.round(devAllow / 4))),
        topUpCap: 150,
        workflows: [
          { id: "team", name: "Team production", owner: "Ops team", every: "weekday", offset: 0, units: devUnits, steps: [str(r0?.id, "run")], channel: "Table" },
          { id: "agent", name: "Nightly agent", owner: "Ops agent", every: "day", offset: 0, units: agentUnits, steps: [str(r1?.id, "run")], channel: "Agent" },
        ],
        inFlight: "agent",
      },
    },
    merchantRoles: { nia: `Growth PM · ${brief.company}`, sam: `Finance lead · ${brief.company}` },
    population: {
      size: 260,
      seed: (Number.parseInt(fnv1a(brief.company).slice(0, 6), 16) % 100000) || 7,
      cogsPerUnit: Math.round(Math.min(cogs, num(m0?.pricePerUnit, 1) * 0.9) * 10000) / 10000,
      unitsPerPrimary: Math.round((1 / r0Cost) * 100) / 100,
      profiles,
      names: [
        ["Atlas", "Juniper", "Quartz", "Harbor", "Vela", "Kite", "Maple", "Onyx", "Saffron", "Delta", "Indigo", "Cinder"],
        ["Media", "Labs", "Studio", "Co", "Works", "Digital", "Group", "Partners", "Agency", "Collective"],
      ],
    },
    experiments: [],
  };
  return { pack: p, filled };
}

const RISK_RANK = { low: 0, medium: 1, high: 2 } as const;

/** Rule-based risk for the approval sheet; every reason names the number behind it. */
export function packRisk(pack: TenantPack, preview: PackPreview | null): { level: "low" | "medium" | "high"; reasons: string[] } {
  const out: { level: keyof typeof RISK_RANK; text: string }[] = [];
  if (preview && preview.marginPct < 0.3) out.push({ level: "high", text: `Simulated gross margin is ${Math.round(preview.marginPct * 100)}%, under 30%.` });
  for (const t of pack.topUpPacks) {
    const m = pack.meters.find((x) => x.id === t.meter);
    if (m && m.pricePerUnit > 0 && t.price / t.units < m.pricePerUnit * 0.95) out.push({ level: "medium", text: `${m.label} pack of ${t.units} sells under list price (${fmtUsd(t.price / t.units, 4)} each).` });
  }
  const unbounded = pack.grantRules.filter((g) => g.rollover.mode === "full" && !g.expiryDays);
  if (unbounded.length && pack.billingModel !== "prepaid") out.push({ level: "medium", text: `${unbounded.length} grant rule${unbounded.length === 1 ? "" : "s"} roll over in full with no expiry: unearned credit liability grows each month.` });
  if (!pack.limits.spend.selfSetCap && !pack.limits.spend.tierCaps) out.push({ level: "medium", text: "Customers can't cap their own spend." });
  if (pack.agents.mcpOnFree) out.push({ level: "low", text: "MCP access is on for the free plan." });
  if (!out.length) out.push({ level: "low", text: "No rule flagged this pack." });
  const level = out.reduce<keyof typeof RISK_RANK>((a, r) => (RISK_RANK[r.level] > RISK_RANK[a] ? r.level : a), "low");
  return { level, reasons: out.map((r) => r.text) };
}

function summary(p: TenantPack): Record<string, string> {
  const rows: Record<string, string> = {
    "Billing model": p.billingModel,
    "Work unit": `${p.workUnit.one} / ${p.workUnit.many}`,
  };
  for (const m of p.meters) rows[`Meter · ${m.id}`] = `${m.label}, ${m.valueType}, list ${fmtUsd(m.pricePerUnit, 4)}`;
  const per = (planId: string, meter: string) => {
    const g = p.grantRules.find((x) => x.plan === planId && x.meter === meter) ?? p.grantRules.find((x) => x.plan === "*" && x.meter === meter);
    return g?.cadence === "daily" ? " a day" : "";
  };
  for (const pl of p.plans) rows[`Plan · ${pl.id}`] = `${pl.name}, ${pl.price == null ? "custom" : `${fmtUsd(pl.price, 0)}/mo`}, ${Object.entries(pl.included).map(([k, v]) => `${v} ${k}${per(pl.id, k)}`).join(" + ") || "nothing included"}`;
  p.grantRules.forEach((g) => {
    rows[`Grant · ${g.plan}/${g.meter}`] = `${g.cadence}${g.monthlyCap ? ` (cap ${g.monthlyCap})` : ""}, rollover ${g.rollover.mode}${g.rollover.mode === "capped" ? ` ${g.rollover.capX}×` : ""}${g.expiryDays ? `, expires ${g.expiryDays}d` : ""}`;
  });
  for (const t of p.topUpPacks) rows[`Top-up · ${t.id}`] = `${t.units} ${t.meter} for ${fmtUsd(t.price)}${t.validityDays ? `, ${t.validityDays} days` : ""}`;
  rows["Auto top-up default"] = `below ${p.autoTopUp.threshold}, add ${p.autoTopUp.amount}, limit ${fmtUsd(p.autoTopUp.monthlySpendLimit, 0)}/mo`;
  rows["Spend limits"] = `${p.limits.spend.selfSetCap ? "self-set cap" : "no self-set cap"}, ${p.limits.spend.tierCaps ? "tier caps" : "no tier caps"}`;
  return rows;
}

/** What loading the pack changes: against the tenant with the same id, or against nothing. */
export function packDiff(before: TenantPack | null, after: TenantPack): DiffRow[] {
  const a = before ? summary(before) : {};
  const b = summary(after);
  const keys = [...new Set([...Object.keys(b), ...Object.keys(a)])];
  return keys.filter((k) => a[k] !== b[k]).map((k) => ({ path: k, before: a[k] ?? "—", after: b[k] ?? "removed" }));
}

export function packHash(pack: unknown): string {
  return fnv1a(JSON.stringify(pack));
}
