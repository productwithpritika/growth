// Bring Your Own Evals (Phase 6). The customer registers AI skills and brings data; each run
// provisions an isolated synthetic tenant and scores every allowed model on the same examples.
// Scores are simulated per example (deterministic for a run), so intervals, paired differences,
// repeat variance and failure clusters are computed, not typed in. The seeded Company research
// scenario is pinned: default 92 at 100% cost, mid-tier 91 at 38%, small 84 at 9%.
import { z } from "zod";
import type { TenantState } from "@/core/types";
import type { TenantPack } from "@/tenants/schema";
import { addDays, fnv1a, mulberry32, normal } from "@/core/time";
import { segmentById } from "@/growth/population";
import type { Check, Dataset, EvalRun, EvalsState, GateState, RubricCriterion, Skill, SkillManifest, SuiteId } from "@/platform/types";

// ------------------------------------------------------------------ catalog

export interface EvalModel {
  id: string;
  name: string;
  tier: string;
  /** Provider cost per run relative to the default (largest) model. */
  relCost: number;
  latencyMs: number;
}

/** Generic model tiers. Invented names: no vendor is implied. */
export const EVAL_MODELS: EvalModel[] = [
  { id: "frontier", name: "Frontier L", tier: "Largest", relCost: 1, latencyMs: 4200 },
  { id: "balanced", name: "Balanced M", tier: "Mid-tier", relCost: 0.38, latencyMs: 1900 },
  { id: "swift", name: "Swift S", tier: "Small", relCost: 0.2, latencyMs: 1150 },
  { id: "compact", name: "Compact XS", tier: "Smallest", relCost: 0.09, latencyMs: 620 },
];
export const modelOf = (id: string): EvalModel => EVAL_MODELS.find((m) => m.id === id) ?? { id, name: id, tier: "Custom", relCost: 1, latencyMs: 2000 };
export const modelName = (id: string) => modelOf(id).name;

export const SUITES: { id: SuiteId; label: string; what: string }[] = [
  { id: "accuracy", label: "Accuracy", what: "Matches the golden label" },
  { id: "rubric", label: "Rubric judge", what: "Judge model scores each output on the rubric, calibrated against human spot-checks" },
  { id: "schema", label: "Schema compliance", what: "Output validates against the skill's output schema" },
  { id: "latency", label: "Latency", what: "p50 and p95 wall time per call" },
  { id: "cost", label: "Cost per run", what: "Provider cost and credits billed per call" },
  { id: "robustness", label: "Robustness", what: "Score drop with typos, mixed case and locale edge cases" },
  { id: "refusal", label: "Refusal behaviour", what: "Declines unsafe or out-of-scope inputs and nothing else" },
  { id: "contact", label: "Contact-data accuracy", what: "Scripted validity checks: syntax, domain, catch-all and bounce simulation" },
];
export const suiteLabel = (id: SuiteId) => SUITES.find((s) => s.id === id)?.label ?? id;

/** Pinned quality (rubric points at the default rubric) per skill and model. */
const QUALITY: Record<string, Record<string, number>> = {
  "company-research": { frontier: 92, balanced: 91, swift: 87, compact: 84 },
  "find-work-email": { frontier: 94, balanced: 89, swift: 86, compact: 79 },
  "summarise-website": { frontier: 90, balanced: 89.5, swift: 89, compact: 86 },
  "classify-icp": { frontier: 93, balanced: 92.6, swift: 92, compact: 91.3 },
};

const SCHEMA: Record<string, number> = { frontier: 0.996, balanced: 0.992, swift: 0.985, compact: 0.975 };
const REFUSAL: Record<string, number> = { frontier: 1, balanced: 1, swift: 0.95, compact: 0.9 };
const ROBUST: Record<string, number> = { frontier: 1.2, balanced: 1.8, swift: 3.1, compact: 5.4 };
const CONTACT: Record<string, number> = { frontier: 0.961, balanced: 0.902, swift: 0.874, compact: 0.821 };

/** Monthly runs per workspace for the impact model. */
const RUNS_PER_WORKSPACE: Record<string, number> = { "company-research": 160, "find-work-email": 420, "summarise-website": 90, "classify-icp": 260 };

const RUBRICS: Record<string, { c: RubricCriterion[]; offsets: number[] }> = {
  "company-research": {
    c: [
      { id: "facts", label: "Facts are correct", weight: 40 },
      { id: "coverage", label: "Covers HQ, size, funding, industry", weight: 30 },
      { id: "sources", label: "Cites a source", weight: 20 },
      { id: "concise", label: "Fits the column", weight: 10 },
    ],
    offsets: [-0.5, 0.5, -2, 4.5],
  },
  "find-work-email": {
    c: [
      { id: "valid", label: "Address is deliverable", weight: 60 },
      { id: "person", label: "Belongs to the right person", weight: 30 },
      { id: "confidence", label: "Confidence is honest", weight: 10 },
    ],
    offsets: [-1, 1, 3],
  },
  "summarise-website": {
    c: [
      { id: "faithful", label: "Faithful to the page", weight: 50 },
      { id: "useful", label: "Useful for outreach", weight: 30 },
      { id: "length", label: "Under 60 words", weight: 20 },
    ],
    offsets: [-1, -0.5, 3.25],
  },
  "classify-icp": {
    c: [
      { id: "label", label: "Right ICP tier", weight: 70 },
      { id: "reason", label: "Gives a usable reason", weight: 30 },
    ],
    offsets: [0.6, -1.4],
  },
};

export const defaultRubric = (skillId: string): RubricCriterion[] => (RUBRICS[skillId]?.c ?? [{ id: "overall", label: "Overall quality", weight: 100 }]).map((c) => ({ ...c }));

const meterPrice = (pack: TenantPack) => pack.meters[0]?.pricePerUnit ?? 0.05;

// ------------------------------------------------------------------ seed

const SEED_MANIFESTS: SkillManifest[] = [
  {
    id: "find-work-email",
    name: "Find work email",
    description: "Find and verify a person's work email from name and company domain.",
    transport: "mcp",
    endpoint: "mcp://skills.tenant.example/find_work_email",
    input: { full_name: "string", company_domain: "string" },
    output: { email: "string", confidence: "number", status: "enum(valid,risky,invalid)" },
    meter: { dataCredits: 3, actions: 1 },
    defaultModel: "frontier",
    allowedModels: ["frontier", "balanced", "swift", "compact"],
    timeoutMs: 12000,
    sideEffects: false,
    pii: "masked",
    idempotent: true,
    rateLimitPerMin: 600,
  },
  {
    id: "company-research",
    name: "Company research",
    description: "Research a company from its domain: HQ, headcount, funding and industry, with a source.",
    transport: "mcp",
    endpoint: "mcp://skills.tenant.example/company_research",
    input: { company_domain: "string", fields: "string[]" },
    output: { summary: "string", hq: "string", headcount: "number", funding: "string", source_url: "string" },
    meter: { dataCredits: 6, actions: 1 },
    defaultModel: "frontier",
    allowedModels: ["frontier", "balanced", "swift", "compact"],
    timeoutMs: 20000,
    sideEffects: false,
    pii: "none",
    idempotent: true,
    rateLimitPerMin: 300,
  },
  {
    id: "summarise-website",
    name: "Summarise website",
    description: "Summarise a company website in under 60 words for outreach.",
    transport: "http",
    endpoint: "https://skills.tenant.example/v1/summarise",
    input: { url: "string" },
    output: { summary: "string", language: "string" },
    meter: { dataCredits: 2, actions: 1 },
    defaultModel: "frontier",
    allowedModels: ["frontier", "balanced", "swift", "compact"],
    timeoutMs: 15000,
    sideEffects: false,
    pii: "none",
    idempotent: true,
    rateLimitPerMin: 600,
  },
  {
    id: "classify-icp",
    name: "Classify ICP fit",
    description: "Classify a company into ICP tier A, B, C or not a fit, with a one-line reason.",
    transport: "http",
    endpoint: "https://skills.tenant.example/v1/classify_icp",
    input: { company_domain: "string", industry: "string", headcount: "number" },
    output: { tier: "enum(A,B,C,none)", reason: "string" },
    meter: { dataCredits: 1, actions: 1 },
    defaultModel: "frontier",
    allowedModels: ["frontier", "balanced", "swift", "compact"],
    timeoutMs: 8000,
    sideEffects: false,
    pii: "none",
    idempotent: true,
    rateLimitPerMin: 1200,
  },
];

/** The wizard's example: fails validation until it is made read-only and idempotent. */
export const EXAMPLE_MANIFEST: SkillManifest = {
  id: "score-lead-intent",
  name: "Score lead intent",
  description: "Score buying intent from recent company signals and write the score back to the CRM.",
  transport: "http",
  endpoint: "https://skills.tenant.example/v1/lead_intent",
  input: { company_domain: "string", signals: "string[]" },
  output: { score: "number", reasons: "string[]" },
  meter: { dataCredits: 2, actions: 1 },
  defaultModel: "frontier",
  allowedModels: ["frontier", "balanced", "compact"],
  timeoutMs: 45000,
  sideEffects: true,
  pii: "masked",
  idempotent: false,
  rateLimitPerMin: 300,
};

/** Tools an MCP skill server lists when connected in the wizard. */
export const MCP_SERVER_SKILLS: SkillManifest[] = [
  EXAMPLE_MANIFEST,
  { ...EXAMPLE_MANIFEST, id: "detect-tech-stack", name: "Detect tech stack", description: "List the technologies a company website uses.", input: { url: "string" }, output: { technologies: "string[]" }, sideEffects: false, idempotent: true, timeoutMs: 15000, meter: { dataCredits: 1, actions: 1 } },
];

function seedDatasets(pack: TenantPack, clockIso: string): Dataset[] {
  const at = (d: number) => addDays(new Date(clockIso), -d).toISOString();
  const region = pack.regions[0]?.id ?? "us";
  return [
    { id: "ds-email", skillId: "find-work-email", name: "Contact validity set", source: "synthetic", rows: 400, columns: ["full_name", "company_domain", "expected_status"], golden: true, region, retentionDays: 90, createdAt: at(20), masked: ["full_name"], description: "Synthetic people at invented domains, 30% catch-all domains, 10% role addresses.", preview: [["[name]", "northwind-labs.example", "valid"], ["[name]", "cedar-freight.example", "risky"], ["[name]", "bluefin.example", "invalid"]] },
    { id: "ds-research", skillId: "company-research", name: "Company research golden set", source: "sample", rows: 240, columns: ["company_domain", "country", "expected_hq", "expected_headcount_band"], golden: true, region, retentionDays: 90, createdAt: at(18), masked: ["company_domain"], description: "Sampled from tenant tables with domains masked; HQ and headcount labelled by two reviewers.", preview: [["[domain]", "US", "Pittsburgh", "201–500"], ["[domain]", "DE", "Munich", "51–200"], ["[domain]", "IN", "Pune", "501–1,000"]] },
    { id: "ds-summaries", skillId: "summarise-website", name: "Website summaries", source: "upload", rows: 180, columns: ["url", "language"], golden: false, region, retentionDays: 30, createdAt: at(15), masked: [], description: "Uploaded, anonymised list of public company websites. No golden labels: scored by the rubric judge.", preview: [["https://[site].example", "en"], ["https://[site].example", "fr"], ["https://[site].example", "ja"]] },
    { id: "ds-icp", skillId: "classify-icp", name: "ICP labels Q3", source: "upload", rows: 320, columns: ["company_domain", "industry", "headcount", "tier"], golden: true, region, retentionDays: 90, createdAt: at(12), masked: ["company_domain"], description: "Sales-ops labelled tiers from last quarter.", preview: [["[domain]", "Logistics", "640", "A"], ["[domain]", "Retail", "45", "C"], ["[domain]", "Fintech", "210", "B"]] },
  ];
}

export function seedSkill(m: SkillManifest, clockIso: string): Skill {
  return { id: m.id, manifest: m, status: "live", registeredAt: clockIso, vault: { ref: `vault://skills/${m.id}`, fingerprint: fnv1a(`seed:${m.id}`).slice(0, 8) }, checks: validateManifest(m, true).checks, inUse: m.defaultModel };
}

export function initEvals(pack: TenantPack, clockIso: string): EvalsState {
  const at = (d: number) => addDays(new Date(clockIso), -d).toISOString();
  const skills = SEED_MANIFESTS.map((m) => seedSkill(m, at(30)));
  const datasets = seedDatasets(pack, clockIso);
  const runs: EvalRun[] = skills.map((s, i) => {
    const ds = datasets.find((d) => d.skillId === s.id)!;
    const suites: SuiteId[] = suitesFor(s, ds);
    return { id: `run-${s.id}-seed`, skillId: s.id, datasetId: ds.id, models: [...s.manifest.allowedModels], suites, repeats: 3, at: at(2 + (i % 2)), sandboxTenant: sandboxId(pack, s.id, `seed${i}`), credits: runCost(ds.rows, s.manifest.allowedModels.length, 3, suites.length), by: "Eval Agent", rubric: defaultRubric(s.id), trigger: "scheduled" };
  });
  return {
    skills,
    datasets,
    runs,
    overrides: [],
    budget: { monthly: 30000 },
    margin: 2,
    rubrics: Object.fromEntries(skills.map((s) => [s.id, defaultRubric(s.id)])),
    // A provider update to the small model nine days ago: summaries got a little worse.
    providerChanges: [{ id: "pc-swift-1", model: "swift", at: at(9), note: "Provider updated Swift S to a new build", drift: { "summarise-website": -2.4 } }],
    alerts: [{ id: "al-swift-1", at: at(8), skillId: "summarise-website", model: "swift", text: "Summarise website on Swift S dropped 2.4 points after the provider update. Re-evaluated automatically.", severity: "watch", routed: false }],
    schedule: { "find-work-email": "weekly", "company-research": "on-change", "summarise-website": "on-change", "classify-icp": "weekly" },
    canary: {},
    defaults: [],
  };
}

// ------------------------------------------------------------------ registry: manifest validation

const ManifestSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]{1,40}$/, "lower-case letters, digits and dashes"),
  name: z.string().min(2).max(60),
  description: z.string().min(5).max(300),
  transport: z.enum(["mcp", "http"]),
  endpoint: z.string().min(8),
  input: z.record(z.string(), z.string()),
  output: z.record(z.string(), z.string()),
  meter: z.object({ dataCredits: z.number().min(0), actions: z.number().min(0) }),
  defaultModel: z.string(),
  allowedModels: z.array(z.string()).min(1),
  timeoutMs: z.number().int().positive(),
  sideEffects: z.boolean(),
  pii: z.enum(["none", "masked", "contains-pii"]),
  idempotent: z.boolean(),
  rateLimitPerMin: z.number().int().nonnegative(),
});

export interface Validation {
  ok: boolean;
  manifest: SkillManifest | null;
  checks: Check[];
  /** One-click fixes the wizard can apply to the manifest. */
  fixes: { check: string; label: string; patch: Partial<SkillManifest> }[];
}

/** Validate a manifest (object or JSON text). `vaulted` and `tested` add the last two checks. */
export function validateManifest(input: unknown, vaulted = false, tested = false): Validation {
  let raw = input;
  if (typeof input === "string") {
    try {
      raw = JSON.parse(input);
    } catch {
      return { ok: false, manifest: null, checks: [{ id: "parse", label: "Manifest parses", ok: false, detail: "Not valid JSON." }], fixes: [] };
    }
  }
  const p = ManifestSchema.safeParse(raw);
  if (!p.success) {
    const first = p.error.issues[0];
    return { ok: false, manifest: null, checks: [{ id: "parse", label: "Manifest parses", ok: false, detail: `${first.path.join(".") || "manifest"}: ${first.message}` }], fixes: [] };
  }
  const m = p.data as SkillManifest;
  const known = new Set(EVAL_MODELS.map((x) => x.id));
  const checks: Check[] = [
    { id: "parse", label: "Manifest parses", ok: true, detail: `${m.transport === "mcp" ? "MCP tool" : "HTTP endpoint"} ${m.endpoint}` },
    { id: "schema", label: "Input and output schema", ok: Object.keys(m.input).length > 0 && Object.keys(m.output).length > 0, detail: `${Object.keys(m.input).length} inputs, ${Object.keys(m.output).length} outputs` },
    { id: "meter", label: "Meter mapping", ok: m.meter.dataCredits + m.meter.actions > 0, detail: `${m.meter.dataCredits} Data Credits and ${m.meter.actions} Actions per call` },
    { id: "models", label: "Models", ok: m.allowedModels.includes(m.defaultModel) && m.allowedModels.every((x) => known.has(x)), detail: m.allowedModels.includes(m.defaultModel) ? `Default ${modelName(m.defaultModel)}, ${m.allowedModels.length} allowed` : "The default model must be in the allowed list" },
    { id: "readonly", label: "Read-only for evals", ok: !m.sideEffects, detail: m.sideEffects ? "Declares side effects. Evals only call read-only skills, so nothing is written during a run." : "No side effects" },
    { id: "idempotent", label: "Idempotency", ok: m.idempotent, detail: m.idempotent ? "Repeat calls with the same key return the same result" : "Repeat calls may differ. Honour an idempotency key so retries are safe." },
    { id: "rate", label: "Rate limits", ok: m.rateLimitPerMin >= 10 && m.rateLimitPerMin <= 6000, detail: m.rateLimitPerMin ? `${m.rateLimitPerMin} calls a minute` : "No rate limit declared" },
    { id: "timeout", label: "Timeout", ok: m.timeoutMs <= 30000, detail: m.timeoutMs <= 30000 ? `${(m.timeoutMs / 1000).toFixed(0)} s` : `${(m.timeoutMs / 1000).toFixed(0)} s is over the 30 s limit` },
    { id: "pii", label: "PII policy", ok: m.pii !== "contains-pii", detail: m.pii === "none" ? "No personal data" : m.pii === "masked" ? "Personal fields masked before the call" : "Sends raw personal data. Mask it first." },
    { id: "vault", label: "Secret in vault", ok: vaulted, detail: vaulted ? "Stored; only a fingerprint is kept here" : "Add the API key or token" },
    { id: "test", label: "Test call", ok: tested, detail: tested ? "Returned output that matches the output schema" : "Not run yet" },
  ];
  const fixes: Validation["fixes"] = [];
  if (m.sideEffects) fixes.push({ check: "readonly", label: "Use the read-only variant (no CRM write-back)", patch: { sideEffects: false } });
  if (!m.idempotent) fixes.push({ check: "idempotent", label: "Honour an idempotency key", patch: { idempotent: true } });
  if (m.timeoutMs > 30000) fixes.push({ check: "timeout", label: "Set the timeout to 20 s", patch: { timeoutMs: 20000 } });
  if (!m.rateLimitPerMin) fixes.push({ check: "rate", label: "Declare 300 calls a minute", patch: { rateLimitPerMin: 300 } });
  if (m.pii === "contains-pii") fixes.push({ check: "pii", label: "Mask personal fields", patch: { pii: "masked" } });
  return { ok: checks.every((c) => c.ok), manifest: m, checks, fixes };
}

/** The checks that must pass before the test call can run. */
export const preTestOk = (v: Validation) => v.checks.filter((c) => c.id !== "test").every((c) => c.ok);

// ------------------------------------------------------------------ data

export const MIN_STABLE_ROWS = 100;

export function datasetWarnings(ds: Pick<Dataset, "rows" | "golden">, skillId?: string): string[] {
  const out: string[] = [];
  if (ds.rows < MIN_STABLE_ROWS) out.push(`Only ${ds.rows} rows: intervals will be wide and a 2-point margin can't be resolved. Use at least ${MIN_STABLE_ROWS}.`);
  if (!ds.golden && skillId !== "summarise-website") out.push("No golden labels: accuracy is skipped and quality comes from the rubric judge alone.");
  return out;
}

const PII_HEADER = /(^|_)(e-?mail|phone|mobile|first_?name|last_?name|full_?name|name|address|linkedin)($|_)/i;
const EMAIL = /[^\s@,]+@[^\s@,]+\.[a-z]{2,}/i;
const PHONE = /\+?\d[\d\s().-]{7,}\d/;

/** Parse a CSV and mask personal columns. Only the header, the count and 3 masked rows are kept. */
export function parseCsv(text: string): { columns: string[]; rows: number; masked: string[]; preview: string[][]; golden: boolean; error: string | null } {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length);
  if (lines.length < 2) return { columns: [], rows: 0, masked: [], preview: [], golden: false, error: "The file needs a header row and at least one data row." };
  const split = (l: string) => {
    const out: string[] = [];
    let cur = "";
    let q = false;
    for (const ch of l) {
      if (ch === '"') q = !q;
      else if (ch === "," && !q) {
        out.push(cur.trim());
        cur = "";
      } else cur += ch;
    }
    out.push(cur.trim());
    return out;
  };
  const columns = split(lines[0]).map((c) => c.replace(/^\ufeff/, ""));
  const body = lines.slice(1).map(split);
  const masked = columns.filter((c, i) => PII_HEADER.test(c) || body.slice(0, 50).some((r) => EMAIL.test(r[i] ?? "") || PHONE.test(r[i] ?? "")));
  const mask = (c: string, v: string) => (masked.includes(c) ? (EMAIL.test(v) ? "[email]" : PHONE.test(v) ? "[phone]" : `[${c.toLowerCase().replace(/[^a-z]/g, "") || "value"}]`) : v);
  const preview = body.slice(0, 3).map((r) => columns.map((c, i) => mask(c, r[i] ?? "")));
  return { columns, rows: body.length, masked, preview, golden: columns.some((c) => /^(label|expected|golden|tier|answer)/i.test(c)), error: null };
}

/** A sample from the tenant's own tables, masked. */
export function sampleDataset(pack: TenantPack, skill: Skill, rows: number, clockIso: string, region: string): Dataset {
  const cols = Object.keys(skill.manifest.input);
  return {
    id: `ds-${fnv1a(`${skill.id}|${clockIso}|${rows}|sample`).slice(0, 6)}`,
    skillId: skill.id,
    name: `${skill.manifest.name} · tenant sample`,
    source: "sample",
    rows,
    columns: [...cols, "expected"],
    golden: false,
    region,
    retentionDays: 30,
    createdAt: clockIso,
    masked: cols.filter((c) => /domain|name|email|url/.test(c)),
    description: `Sampled from ${pack.company} tables with personal and company identifiers masked.`,
    preview: [0, 1, 2].map(() => [...cols.map((c) => (/domain|name|email|url/.test(c) ? `[${c.replace(/_/g, "")}]` : "…")), "—"]),
  };
}

/** A synthetic set that matches a described distribution. */
export function syntheticDataset(skill: Skill, rows: number, description: string, mix: number, clockIso: string, region: string): Dataset {
  const cols = Object.keys(skill.manifest.input);
  return {
    id: `ds-${fnv1a(`${skill.id}|${clockIso}|${rows}|${description}`).slice(0, 6)}`,
    skillId: skill.id,
    name: `${skill.manifest.name} · synthetic`,
    source: "synthetic",
    rows,
    columns: [...cols, "expected"],
    golden: true,
    region,
    retentionDays: 30,
    createdAt: clockIso,
    masked: [],
    description: `${description.trim() || "Synthetic examples"} (${mix}% edge cases).`,
    preview: [0, 1, 2].map((i) => [...cols.map((c) => `${c.split("_")[0]}-${i + 1}.example`), i === 2 ? "edge case" : "typical"]),
  };
}

// ------------------------------------------------------------------ runs

export function runCost(rows: number, models: number, repeats: number, suites: number): number {
  return Math.round(rows * models * repeats * (0.25 + suites * 0.1));
}

export function sandboxId(pack: TenantPack, skillId: string, salt: string): string {
  return `sbx-${pack.id}-${skillId.split("-")[0]}-${fnv1a(`${skillId}|${salt}`).slice(0, 4)}`;
}

export function suitesFor(skill: Skill, ds: Pick<Dataset, "golden">): SuiteId[] {
  const s: SuiteId[] = ["rubric", "schema", "latency", "cost", "robustness", "refusal"];
  if (ds.golden) s.unshift("accuracy");
  if (skill.id === "find-work-email" || /email|contact/i.test(skill.manifest.name)) s.push("contact");
  return s;
}

export function monthUsed(ev: EvalsState, clockIso: string): number {
  const ym = clockIso.slice(0, 7);
  return ev.runs.filter((r) => r.at.slice(0, 7) === ym).reduce((s, r) => s + r.credits, 0);
}

/** What the isolated test tenant mirrors from the pack. Nothing touches production. */
export function sandboxTenant(pack: TenantPack, run: Pick<EvalRun, "sandboxTenant" | "skillId">) {
  return {
    id: run.sandboxTenant,
    plans: pack.plans.length,
    meters: pack.meters.map((m) => m.label),
    limits: `${pack.limits.rate.runsPerMinute} runs a minute, ${pack.limits.rate.agentRunsPerHour} agent runs an hour`,
    users: 50,
    workflows: 3,
    production: false,
  };
}

// ------------------------------------------------------------------ scoring

export interface Interval {
  mean: number;
  lo: number;
  hi: number;
}

export interface ModelResult {
  model: string;
  quality: Interval & { sd: number; repeatSd: number };
  /** Paired difference against the default model on the same examples. */
  diff: Interval;
  suites: Partial<Record<SuiteId, { value: number; lo: number; hi: number; unit: string; state: GateState; display: string }>>;
  creditsPerRun: number;
  costPerRun: number;
  costShare: number;
  latencyP50: number;
  latencyP95: number;
  perExample: number[];
}

export interface RunResult {
  run: EvalRun;
  n: number;
  defaultModel: string;
  models: ModelResult[];
  judge: { agreement: number; kappa: number; humanLabels: number };
}

const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));
const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / Math.max(1, xs.length);
const sdOf = (xs: number[]) => {
  const m = mean(xs);
  return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / Math.max(1, xs.length - 1));
};
const wilson = (p: number, n: number): [number, number] => {
  const zz = 1.96;
  const d = 1 + (zz * zz) / n;
  const c = (p + (zz * zz) / (2 * n)) / d;
  const h = (zz * Math.sqrt((p * (1 - p)) / n + (zz * zz) / (4 * n * n))) / d;
  return [Math.max(0, c - h), Math.min(1, c + h)];
};

/** Drift (quality points) a model carries for a skill at a date, from provider changes. */
export function driftAt(ev: Pick<EvalsState, "providerChanges">, skillId: string, model: string, at: string): number {
  const t = new Date(at).getTime();
  return ev.providerChanges.filter((c) => c.model === model && new Date(c.at).getTime() <= t).reduce((s, c) => s + (c.drift[skillId] ?? 0), 0);
}

/** Target quality for a model under a rubric (weights), before drift. */
export function targetQuality(skillId: string, model: string, rubric: RubricCriterion[]): number {
  const base = QUALITY[skillId]?.[model] ?? 80 + 10 * modelOf(model).relCost;
  const spec = RUBRICS[skillId];
  if (!spec) return base;
  const s = 1 - modelOf(model).relCost;
  const total = rubric.reduce((a, c) => a + Math.max(0, c.weight), 0) || 1;
  return rubric.reduce((a, c) => {
    const i = spec.c.findIndex((x) => x.id === c.id);
    return a + (Math.max(0, c.weight) / total) * (base + s * (i >= 0 ? spec.offsets[i] : 0));
  }, 0);
}

const resultCache = new Map<string, RunResult>();

/** Score every model in a run. Deterministic for the run, dataset size, rubric and provider history. */
export function runResult(ev: EvalsState, run: EvalRun, pack: TenantPack): RunResult {
  const ds = ev.datasets.find((d) => d.id === run.datasetId);
  const skill = ev.skills.find((s) => s.id === run.skillId);
  const n = Math.max(10, Math.min(ds?.rows ?? 100, 2000));
  const key = `${run.id}|${n}|${JSON.stringify(run.rubric)}|${ev.providerChanges.map((c) => c.id + c.at).join(",")}|${pack.meters[0]?.pricePerUnit}`;
  const hit = resultCache.get(key);
  if (hit) return hit;
  const def = skill?.manifest.defaultModel ?? run.models[0];
  const models = run.models.includes(def) ? run.models : [def, ...run.models];
  const diffR = mulberry32(parseInt(fnv1a(`${run.skillId}|${run.datasetId}|difficulty`), 16));
  const difficulty = Array.from({ length: n }, () => normal(diffR));
  const price = meterPrice(pack);
  const creditsDef = skill?.manifest.meter.dataCredits ?? 1;
  const costDefUsd = creditsDef * price * 0.62;
  const per = new Map<string, { ex: number[]; repeatMeans: number[] }>();
  for (const m of models) {
    const rel = modelOf(m).relCost;
    const sens = 6 + 4 * (1 - rel);
    const sigma = 3 + 3 * (1 - rel);
    const r = mulberry32(parseInt(fnv1a(`${run.id}|${m}`), 16));
    const target = targetQuality(run.skillId, m, run.rubric) + driftAt(ev, run.skillId, m, run.at);
    const reps: number[][] = Array.from({ length: run.repeats }, () => difficulty.map((d) => target - sens * d + sigma * normal(r)));
    const ex0 = difficulty.map((_, i) => mean(reps.map((k) => k[i])));
    const shift = target - mean(ex0);
    const ex = ex0.map((x) => clamp(x + shift, 0, 100));
    const fix = target - mean(ex);
    per.set(m, { ex: ex.map((x) => x + fix), repeatMeans: reps.map((k) => mean(k) + shift) });
  }
  const base = per.get(def)!.ex;
  const out: ModelResult[] = models.map((m) => {
    const { ex, repeatMeans } = per.get(m)!;
    const q = mean(ex);
    const se = sdOf(ex) / Math.sqrt(n);
    const d = ex.map((x, i) => x - base[i]);
    const dm = mean(d);
    const dse = m === def ? 0 : sdOf(d) / Math.sqrt(n);
    const rel = modelOf(m).relCost;
    const credits = creditsDef * (0.25 + 0.75 * rel);
    const latencyP50 = Math.round(modelOf(m).latencyMs * (0.6 + 0.2 * creditsDef ** 0.5));
    const suites: ModelResult["suites"] = {};
    const nr = n * run.repeats;
    for (const sid of run.suites) {
      if (sid === "accuracy") {
        const p = clamp(q / 100 - 0.015, 0, 1);
        const [lo, hi] = wilson(p, n);
        suites.accuracy = { value: p, lo, hi, unit: "%", state: "pass", display: pct(p) };
      } else if (sid === "rubric") {
        suites.rubric = { value: q, lo: q - 1.96 * se, hi: q + 1.96 * se, unit: "pts", state: "pass", display: q.toFixed(1) };
      } else if (sid === "schema") {
        const p = SCHEMA[m] ?? 0.98;
        const [lo, hi] = wilson(p, nr);
        suites.schema = { value: p, lo, hi, unit: "%", state: p >= 0.98 ? "pass" : p >= 0.97 ? "warn" : "fail", display: pct(p, 1) };
      } else if (sid === "latency") {
        const p95 = Math.round(latencyP50 * 2.1);
        const timeout = skill?.manifest.timeoutMs ?? 30000;
        suites.latency = { value: latencyP50, lo: latencyP50 * 0.96, hi: latencyP50 * 1.04, unit: "ms", state: p95 <= timeout ? "pass" : "fail", display: `${(latencyP50 / 1000).toFixed(1)} s p50 · ${(p95 / 1000).toFixed(1)} s p95` };
      } else if (sid === "cost") {
        const c = costDefUsd * rel;
        suites.cost = { value: c, lo: c * 0.97, hi: c * 1.03, unit: "$", state: "pass", display: `$${c.toFixed(4)} · ${credits.toFixed(2)} credits` };
      } else if (sid === "robustness") {
        const drop = (ROBUST[m] ?? 3) * (run.skillId === "classify-icp" ? 0.7 : 1);
        suites.robustness = { value: drop, lo: drop - 0.6, hi: drop + 0.6, unit: "pts", state: drop <= 4 ? "pass" : drop <= 6 ? "warn" : "fail", display: `−${drop.toFixed(1)} pts` };
      } else if (sid === "refusal") {
        const p = REFUSAL[m] ?? 0.95;
        const [lo, hi] = wilson(p, 20 * run.repeats);
        suites.refusal = { value: p, lo, hi, unit: "%", state: p >= 0.95 ? "pass" : p >= 0.9 ? "warn" : "fail", display: pct(p) };
      } else if (sid === "contact") {
        const p = CONTACT[m] ?? 0.9;
        const [lo, hi] = wilson(p, n);
        suites.contact = { value: p, lo, hi, unit: "%", state: p >= 0.94 ? "pass" : p >= 0.92 ? "warn" : "fail", display: pct(p, 1) };
      }
    }
    return {
      model: m,
      quality: { mean: q, lo: q - 1.96 * se, hi: q + 1.96 * se, sd: sdOf(ex), repeatSd: run.repeats > 1 ? sdOf(repeatMeans) : 0 },
      diff: { mean: dm, lo: dm - 1.96 * dse, hi: dm + 1.96 * dse },
      suites,
      creditsPerRun: credits,
      costPerRun: costDefUsd * rel,
      costShare: rel,
      latencyP50,
      latencyP95: Math.round(latencyP50 * 2.1),
      perExample: ex,
    };
  });
  const res: RunResult = { run, n, defaultModel: def, models: out, judge: { agreement: 0.91, kappa: 0.82, humanLabels: 40 } };
  if (resultCache.size > 200) resultCache.clear();
  resultCache.set(key, res);
  return res;
}

const pct = (p: number, d = 0) => `${(p * 100).toFixed(d)}%`;
/** Quality points: whole numbers stay whole, halves keep one decimal. */
export const fmtQ = (x: number) => (Math.abs(x - Math.round(x)) < 0.05 ? Math.round(x).toFixed(0) : x.toFixed(1));

export function latestRun(ev: EvalsState, skillId: string, model?: string): EvalRun | null {
  const xs = ev.runs.filter((r) => r.skillId === skillId && (!model || r.models.includes(model)));
  return xs.sort((a, b) => b.at.localeCompare(a.at))[0] ?? null;
}

// ------------------------------------------------------------------ gate and recommendation

export interface Gate {
  state: GateState;
  reasons: string[];
  run: EvalRun | null;
  result: ModelResult | null;
}

const WORST: Record<GateState, number> = { pass: 0, warn: 1, fail: 2, none: 3 };
const worse = (a: GateState, b: GateState): GateState => (WORST[a] >= WORST[b] ? a : b);

/** The quality gate for using `model` on a skill: pass, warn, fail, or none (no eval yet). */
export function gateFor(ev: EvalsState, pack: TenantPack, skillId: string, model: string): Gate {
  const run = latestRun(ev, skillId, model);
  if (!run) return { state: "none", reasons: ["No eval has scored this model yet. Run one first."], run: null, result: null };
  const res = runResult(ev, run, pack);
  const r = res.models.find((x) => x.model === model)!;
  let state: GateState = "pass";
  const reasons: string[] = [];
  const margin = ev.margin;
  if (model !== res.defaultModel) {
    if (r.diff.mean < -margin) {
      state = "fail";
      reasons.push(`Quality is ${Math.abs(r.diff.mean).toFixed(1)} points below ${modelName(res.defaultModel)}, beyond the ${margin}-point margin.`);
    } else if (r.diff.lo < -margin) {
      state = worse(state, "warn");
      reasons.push(`The 95% interval (${r.diff.lo.toFixed(1)} to ${r.diff.hi.toFixed(1)}) crosses the ${margin}-point margin: not proven non-inferior.`);
    } else reasons.push(`Within the ${margin}-point margin: ${r.diff.mean.toFixed(1)} points (95% interval ${r.diff.lo.toFixed(1)} to ${r.diff.hi.toFixed(1)}).`);
  }
  for (const [sid, v] of Object.entries(r.suites) as [SuiteId, NonNullable<ModelResult["suites"][SuiteId]>][]) {
    if (v.state === "fail") reasons.push(`${suiteLabel(sid)} fails: ${v.display}.`);
    if (v.state === "warn") reasons.push(`${suiteLabel(sid)} is borderline: ${v.display}.`);
    state = worse(state, v.state);
  }
  const ds = ev.datasets.find((d) => d.id === run.datasetId);
  if (ds && ds.rows < MIN_STABLE_ROWS) {
    state = worse(state, "warn");
    reasons.push(`The dataset has ${ds.rows} rows, under the ${MIN_STABLE_ROWS} needed for a stable result.`);
  }
  const lastChange = ev.providerChanges.filter((c) => c.model === model).sort((a, b) => b.at.localeCompare(a.at))[0];
  if (lastChange && lastChange.at > run.at) {
    state = worse(state, "warn");
    reasons.push(`The provider changed ${modelName(model)} after this eval. Re-run it.`);
  }
  return { state, reasons, run, result: r };
}

export interface Recommendation {
  skillId: string;
  current: string;
  model: string;
  switch: boolean;
  text: string;
  result: RunResult | null;
}

/** The cheapest allowed model that passes the gate (non-inferior within the margin), or stay. */
export function recommend(ev: EvalsState, pack: TenantPack, skillId: string): Recommendation {
  const skill = ev.skills.find((s) => s.id === skillId);
  const def = skill?.manifest.defaultModel ?? "frontier";
  const run = latestRun(ev, skillId);
  if (!skill || !run) return { skillId, current: def, model: def, switch: false, text: "Run an eval to get a recommendation.", result: null };
  const res = runResult(ev, run, pack);
  const cheaper = res.models.filter((m) => m.model !== def && m.costShare < 1).sort((a, b) => a.costShare - b.costShare);
  const pick = cheaper.find((m) => gateFor(ev, pack, skillId, m.model).state === "pass");
  const d = res.models.find((m) => m.model === def)!;
  if (!pick) {
    const best = cheaper.sort((a, b) => b.quality.mean - a.quality.mean)[0];
    return { skillId, current: def, model: def, switch: false, text: `Keep ${modelName(def)}. ${best ? `The closest cheaper model, ${modelName(best.model)}, scores ${best.quality.mean.toFixed(1)} against ${d.quality.mean.toFixed(1)} and does not pass the gate.` : "No cheaper model is allowed."}`, result: res };
  }
  return {
    skillId,
    current: def,
    model: pick.model,
    switch: true,
    text: `Switch ${skill.manifest.name} from ${modelName(def)} to ${modelName(pick.model)}. It scores ${fmtQ(pick.quality.mean)} against ${fmtQ(d.quality.mean)} (difference ${pick.diff.mean.toFixed(1)}, 95% interval ${pick.diff.lo.toFixed(1)} to ${pick.diff.hi.toFixed(1)}), inside the ${ev.margin}-point margin, at ${Math.round(pick.costShare * 100)}% of the cost.`,
    result: res,
  };
}

/** Models on the cost–quality Pareto frontier (no other model is both cheaper and better). */
export function pareto(ms: Pick<ModelResult, "model" | "costShare" | "quality">[]): string[] {
  return ms.filter((a) => !ms.some((b) => b.model !== a.model && b.costShare <= a.costShare && b.quality.mean >= a.quality.mean && (b.costShare < a.costShare || b.quality.mean > a.quality.mean))).map((m) => m.model);
}

// ------------------------------------------------------------------ impact with a scenario slider

export interface Impact {
  cohort: { id: string; label: string; size: number };
  runs: number;
  creditsBefore: number;
  creditsAfter: number;
  creditsSavedPerRun: number;
  spendPerWorkspace: { before: number; after: number };
  marginPerCredit: { before: number; after: number };
  revenue: { before: number; after: number; change: number };
  cost: { before: number; after: number };
  exhaustion: { before: number; after: number };
  retainedAccounts: number;
  retainedRevenue: number;
  netRevenue: number;
  netGrossProfit: number;
  /** Twelve months: the monthly revenue change every month, plus retained accounts that keep paying and accumulate. */
  year: { revenue: number; grossProfit: number };
}

export const IMPACT_COHORT = "paid-topup";

/** Monthly effect of moving the fastest-burning cohort to `model`. `reinvest` (0–1): share of the saved credits users spend on more runs. */
export function impactOf(t: Pick<TenantState, "pack" | "population" | "clock"> & { growth?: { anchor: string } }, ev: EvalsState, skillId: string, model: string, reinvest: number): Impact {
  const pack = t.pack;
  const skill = ev.skills.find((s) => s.id === skillId);
  const seg = segmentById(t, IMPACT_COHORT);
  const size = seg?.size ?? 1000;
  const arpa = seg && seg.size ? seg.stake / seg.size : 250;
  const def = skill?.manifest.defaultModel ?? "frontier";
  const creditsDef = skill?.manifest.meter.dataCredits ?? 1;
  const p = meterPrice(pack);
  const c0 = creditsDef * (0.25 + 0.75 * modelOf(def).relCost);
  const c1 = creditsDef * (0.25 + 0.75 * modelOf(model).relCost);
  const k0 = creditsDef * p * 0.62 * modelOf(def).relCost;
  const k1 = creditsDef * p * 0.62 * modelOf(model).relCost;
  const s = clamp(reinvest, 0, 1);
  const R = size * (RUNS_PER_WORKSPACE[skillId] ?? 100);
  const dc = c0 - c1;
  const revBefore = R * c0 * p;
  const revAfter = revBefore - (1 - s) * R * dc * p;
  const extraRuns = c1 > 0 ? (s * R * dc) / c1 : 0;
  const costBefore = R * k0;
  const costAfter = (R + extraRuns) * k1;
  const e0 = 0.34;
  const e1 = e0 * (1 - (1 - s) * (c0 > 0 ? dc / c0 : 0));
  const churnIfExhausted = 0.12;
  const retained = size * churnIfExhausted * (e0 - e1);
  const retainedRevenue = retained * arpa;
  const gm = revBefore > 0 ? 1 - costBefore / revBefore : 0.38;
  return {
    cohort: { id: IMPACT_COHORT, label: seg?.label ?? "Paid · buys top-ups", size },
    runs: R,
    creditsBefore: c0,
    creditsAfter: c1,
    creditsSavedPerRun: dc,
    spendPerWorkspace: { before: revBefore / size, after: revAfter / size },
    marginPerCredit: { before: c0 > 0 ? p - k0 / c0 : 0, after: c1 > 0 ? p - k1 / c1 : 0 },
    revenue: { before: revBefore, after: revAfter, change: revAfter - revBefore },
    cost: { before: costBefore, after: costAfter },
    exhaustion: { before: e0, after: e1 },
    retainedAccounts: retained,
    retainedRevenue,
    netRevenue: revAfter - revBefore + retainedRevenue,
    netGrossProfit: revAfter - costAfter - (revBefore - costBefore) + retainedRevenue * gm,
    // Month m keeps m months of retained accounts: Σ m for m = 1…12 = 78.
    year: { revenue: 12 * (revAfter - revBefore) + retainedRevenue * 78, grossProfit: 12 * (revAfter - costAfter - (revBefore - costBefore)) + retainedRevenue * gm * 78 },
  };
}

// ------------------------------------------------------------------ results experience

export interface Example {
  i: number;
  input: string;
  outputs: { model: string; text: string; score: number }[];
}

const COMPANIES = ["Northwind Labs", "Bluefin Analytics", "Cedar Freight", "Orchid Health", "Granite Robotics", "Lumen Payroll", "Kestrel Mobility", "Harbor Foods", "Saffron Studio", "Pylon Energy", "Quartz Learning", "Tidewater Logistics"];
const CITIES = ["Pittsburgh", "Munich", "Pune", "Austin", "Lyon", "Toronto", "Leeds", "Osaka", "Denver", "Bengaluru", "Porto", "Utrecht"];

function exampleText(skillId: string, i: number, model: string, score: number): { input: string; text: string } {
  const c = COMPANIES[i % COMPANIES.length];
  const dom = `${c.toLowerCase().replace(/\s+/g, "-")}.example`;
  const city = CITIES[(i * 7) % CITIES.length];
  const head = [120, 340, 860, 45, 2100, 510][i % 6];
  const weak = score < 85;
  const terse = modelOf(model).relCost < 0.5;
  switch (skillId) {
    case "company-research":
      return {
        input: `company_domain: ${dom}`,
        text: weak
          ? `${c}: ${terse ? "software company" : "technology company"}, HQ ${CITIES[(i * 7 + 3) % CITIES.length]} (unverified), about ${Math.round(head * 1.6)} staff. No source.`
          : `${c}: HQ ${city}, about ${head} staff, Series ${"ABC"[i % 3]}. Source: company about page.`,
      };
    case "find-work-email":
      return { input: `full_name: [name] · company_domain: ${dom}`, text: weak ? `[name]@${dom} · confidence 0.71 · risky (catch-all domain not flagged)` : `[name]@${dom} · confidence 0.94 · valid` };
    case "summarise-website":
      return { input: `url: https://${dom}`, text: weak ? `${c} is a company that offers products and services to customers in many markets around the world, with a focus on quality.` : `${c} sells ${["route planning", "payroll", "lab analytics"][i % 3]} software to mid-size teams; recent launch targets ${city}.` };
    default:
      return { input: `company_domain: ${dom} · headcount ${head}`, text: weak ? `Tier B · "Looks like a fit"` : `Tier ${head > 300 ? "A" : head > 100 ? "B" : "C"} · ${head > 300 ? "Logistics, 300+ staff, uses a CRM" : "Smaller team, partial fit"}` };
  }
}

/** Side-by-side examples, hardest first for the candidate. */
export function examples(res: RunResult, candidate: string, count = 8): Example[] {
  const cand = res.models.find((m) => m.model === candidate) ?? res.models[0];
  const def = res.models.find((m) => m.model === res.defaultModel)!;
  const order = cand.perExample.map((s, i) => ({ s, i })).sort((a, b) => a.s - b.s).slice(0, count);
  return order.map(({ i }) => {
    const a = exampleText(res.run.skillId, i, def.model, def.perExample[i]);
    const b = exampleText(res.run.skillId, i, cand.model, cand.perExample[i]);
    return { i, input: a.input, outputs: [{ model: def.model, text: a.text, score: def.perExample[i] }, ...(cand.model === def.model ? [] : [{ model: cand.model, text: b.text, score: cand.perExample[i] }])] };
  });
}

const CLUSTERS: Record<string, { label: string; w: number }[]> = {
  "company-research": [
    { label: "Non-English websites: missed or guessed the HQ city", w: 0.36 },
    { label: "Subsidiary confused with the parent company", w: 0.26 },
    { label: "Stale headcount from an old source", w: 0.22 },
    { label: "Answer too long for the column", w: 0.16 },
  ],
  "find-work-email": [
    { label: "Catch-all domains marked valid", w: 0.44 },
    { label: "Role addresses (info@, sales@) returned for a person", w: 0.31 },
    { label: "Recently changed jobs: old employer's domain", w: 0.25 },
  ],
  "summarise-website": [
    { label: "Generic filler instead of what the company sells", w: 0.48 },
    { label: "Over 60 words", w: 0.3 },
    { label: "Summarised a cookie banner or login page", w: 0.22 },
  ],
  "classify-icp": [
    { label: "Borderline headcount (90–110) put in the wrong tier", w: 0.55 },
    { label: "Reason restates the label without evidence", w: 0.45 },
  ],
};

/** Failing examples (score under 80) grouped into plain-language clusters. */
export function failureClusters(res: RunResult, model: string): { label: string; count: number; share: number }[] {
  const m = res.models.find((x) => x.model === model);
  if (!m) return [];
  const defs = CLUSTERS[res.run.skillId] ?? [{ label: "Low-quality output", w: 1 }];
  const counts = defs.map(() => 0);
  m.perExample.forEach((s, i) => {
    if (s >= 80) return;
    const u = parseInt(fnv1a(`${res.run.skillId}|cluster|${i}`), 16) / 0xffffffff;
    let acc = 0;
    const k = defs.findIndex((d) => (acc += d.w) >= u);
    counts[k < 0 ? defs.length - 1 : k] += 1;
  });
  const total = counts.reduce((a, b) => a + b, 0);
  return defs.map((d, i) => ({ label: d.label, count: counts[i], share: total ? counts[i] / total : 0 })).filter((c) => c.count > 0).sort((a, b) => b.count - a.count);
}

// ------------------------------------------------------------------ regression watch

/** Daily scheduled re-eval scores for the last `days` days (drift chart). */
export function driftSeries(ev: EvalsState, skillId: string, model: string, clockIso: string, days = 30): { x: string; y: number; change: boolean }[] {
  const out: { x: string; y: number; change: boolean }[] = [];
  const rubric = ev.rubrics[skillId] ?? defaultRubric(skillId);
  const q = targetQuality(skillId, model, rubric);
  const r = mulberry32(parseInt(fnv1a(`drift|${skillId}|${model}`), 16));
  for (let d = days - 1; d >= 0; d--) {
    const at = addDays(new Date(clockIso), -d).toISOString();
    const day = at.slice(0, 10);
    const change = ev.providerChanges.some((c) => c.model === model && c.at.slice(0, 10) === day);
    out.push({ x: day, y: Math.round((q + driftAt(ev, skillId, model, at) + normal(r) * 0.35) * 10) / 10, change });
  }
  return out;
}

/** Canary reading for a running experiment's model on a day. */
export function canaryReading(ev: EvalsState, skillId: string, model: string, at: string, salt: string): number {
  const r = mulberry32(parseInt(fnv1a(`canary|${salt}|${at.slice(0, 10)}`), 16));
  const rubric = ev.rubrics[skillId] ?? defaultRubric(skillId);
  return Math.round((targetQuality(skillId, model, rubric) + driftAt(ev, skillId, model, at) + normal(r) * 0.4) * 10) / 10;
}

/** The canary floor: the default model's quality minus the margin and a half-point noise allowance. */
export function canaryFloor(ev: EvalsState, skillId: string, defaultModel: string, at: string): number {
  const rubric = ev.rubrics[skillId] ?? defaultRubric(skillId);
  return targetQuality(skillId, defaultModel, rubric) + driftAt(ev, skillId, defaultModel, at) - ev.margin - 0.5;
}
