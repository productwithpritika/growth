// Tenant Pack schema. Packs are JSON, parsed and validated at runtime: anything a
// surface reads (meters, plans, grant rules, packs, limits, moments, copy) comes
// through this schema, so a new tenant is a new JSON file, not new code.
import { z } from "zod";

const Id = z.string().regex(/^[a-z0-9][a-z0-9-]{0,39}$/, "Use a short lowercase id (a-z, 0-9, -)");
const Color = z
  .string()
  .regex(/^(#[0-9a-fA-F]{6}|oklch\(\s*[0-9.]+\s+[0-9.]+\s+[0-9.]+\s*\))$/, "Use #rrggbb or oklch(L C H)");
const Amounts = z.record(z.string(), z.number().nonnegative());

export const MOMENT_IDS = [
  "ran-out",
  "run-out-forecast",
  "payment-failed",
  "plan-fit",
  "reward-available",
  "expiring-soon",
  "approval-needed",
  "run-blocked",
  "threshold",
  "mid-run",
  "auto-cap",
  "card-expiring",
  "soft-landing",
  "request-credits",
  "spark",
] as const;

export const MeterSchema = z.object({
  id: Id,
  label: z.string().min(1).max(40),
  unit: z.string().min(1).max(30),
  pricePerUnit: z.number().nonnegative(),
  valueType: z.enum(["credits", "actions", "currency"]),
  decimals: z.number().int().min(0).max(4).default(1),
  hint: z.string().max(200).default(""),
});

export const PlanSchema = z.object({
  id: Id,
  name: z.string().min(1).max(40),
  price: z.number().nonnegative().nullable(),
  paid: z.boolean(),
  proposed: z.boolean().default(false),
  included: Amounts,
  meterPrice: Amounts.default({}),
  caps: z.record(z.string(), z.number().nonnegative()).default({}),
  features: z.array(z.string()).default([]),
  highlights: z.array(z.string()).default([]),
});

export const GrantRuleSchema = z.object({
  plan: z.string().min(1),
  meter: Id,
  cadence: z.enum(["monthly", "daily"]),
  monthlyCap: z.number().positive().nullable().default(null),
  rollover: z.object({ mode: z.enum(["none", "capped", "full"]), capX: z.number().min(0).default(1) }),
  expiryDays: z.number().int().positive().nullable().default(null),
});

export const TopUpPackSchema = z.object({
  id: Id,
  meter: Id,
  units: z.number().positive(),
  price: z.number().nonnegative(),
  validityDays: z.number().int().positive().nullable().default(null),
  proposed: z.boolean().default(false),
});

export const RateItemSchema = z.object({
  id: Id,
  label: z.string().min(1).max(60),
  costs: Amounts,
  hitRate: z.number().min(0).max(1).default(1),
  chargeOnHit: z.boolean().default(false),
  providerCost: z.number().nonnegative(),
  requires: z.string().optional(),
  byok: z.boolean().default(false),
  model: z.string().optional(),
  /** Marketplace provider shown in the usage explainer (illustrative names). */
  provider: z.string().max(40).optional(),
  /** For contact lookups: the share of found rows that also verify. Marks the column as producing verified contacts. */
  verifiedShare: z.number().min(0).max(1).optional(),
  /** On an own-key item: the rate item it replaces when a customer brings their own API key. */
  byokFor: z.string().optional(),
});

export const WorkflowSchema = z.object({
  id: Id,
  name: z.string().min(1).max(60),
  owner: z.string().min(1).max(60),
  every: z.enum(["week", "weekday", "day"]),
  offset: z.number().int().min(0).max(6).default(0),
  units: z.number().int().positive(),
  steps: z.array(z.string()).min(1),
  channel: z.enum(["Table", "MCP", "Agent"]).default("Table"),
});

const CardSchema = z.object({ brand: z.string(), last4: z.string().regex(/^[0-9]{4}$/), expires: z.string(), status: z.enum(["ok", "expired"]) });

export const TeamMemberSchema = z.object({
  id: Id,
  name: z.string().min(1).max(40),
  title: z.string().max(40).default(""),
  role: z.enum(["admin", "billing", "member"]),
  /** The member the global "Member" persona plays. */
  persona: z.boolean().default(false),
});

export const HubPersonaDemoSchema = z.object({
  planId: z.string(),
  role: z.string(),
  blurb: z.string(),
  seats: z.number().int().positive().default(1),
  carryIn: Amounts.default({}),
  expiredAtStart: Amounts.default({}),
  card: CardSchema,
  backupCard: CardSchema.nullable().default(null),
  autoTopUp: z.object({
    enabled: z.boolean(),
    meter: z.string(),
    threshold: z.number().nonnegative(),
    units: z.number().positive(),
    /** At the monthly cap: stop topping up, or ask the admin to allow one more pack. */
    atCap: z.enum(["stop", "ask"]).default("stop"),
    /** When the charge fails: try the backup method, retry tomorrow, or pause auto top-up. */
    onFail: z.enum(["backup", "retry", "pause"]).default("backup"),
    /** "I changed my mind": auto top-up is off until this date (ISO), then resumes. */
    pausedUntil: z.string().nullable().default(null),
  }),
  topUpCap: z.number().nonnegative(),
  workflows: z.array(WorkflowSchema).min(1),
  inFlight: z.string().nullable().default(null),
  /** Billing region pack (us, eu, in) the account starts in. */
  region: z.string().default("us"),
  /** Teammates on this workspace. Empty: derived from workflow owners, all Members. */
  team: z.array(TeamMemberSchema).default([]),
  /** The table the pre-run estimator opens with. */
  table: z.object({ name: z.string().min(1).max(60), rows: z.number().int().positive(), source: z.string().max(60).default("CSV import") }).optional(),
  /** Verified work domain: one reward wallet per domain. */
  domain: z.string().default("example.com"),
});

/** Credits Hub rules (Phase 2): thresholds, rewards, dunning, pause, plan change and offers. All have defaults. */
export const HubConfigSchema = z.object({
  /** Usage thresholds (percent of the cycle allowance) that raise a moment. */
  thresholds: z.array(z.number().int().min(1).max(100)).default([80, 90, 100]),
  spark: z
    .object({
      amount: z.number().positive().default(5),
      meter: z.string().optional(),
      minRows: z.number().int().positive().default(25),
      monthlyCap: z.number().nonnegative().default(50),
      expiryDays: z.number().int().positive().default(7),
      label: z.string().default("Daily Spark"),
    })
    .prefault({}),
  activation: z.object({ amount: z.number().nonnegative().default(20), minRows: z.number().int().positive().default(25) }).prefault({}),
  badges: z
    .array(z.object({ id: Id, label: z.string(), reason: z.string(), amount: z.number().nonnegative().default(0) }))
    .default([
      { id: "verify-first", label: "Checked before sending", reason: "Verified emails before sending a sequence", amount: 0 },
      { id: "estimator", label: "Measured twice", reason: "Used the cost estimator before a big run", amount: 0 },
      { id: "own-key", label: "Own key", reason: "Added your own API key for a provider", amount: 0 },
      { id: "workflow", label: "Builder", reason: "Built a workflow the team reuses", amount: 0 },
      { id: "teammate", label: "Team player", reason: "Invited a teammate who ran a table", amount: 0 },
      { id: "bad-record", label: "Data steward", reason: "Reported a bad record so it gets fixed", amount: 0 },
    ]),
  antiAbuse: z
    .object({ walletPerDomain: z.boolean().default(true), maxGrantsPerDay: z.number().int().positive().default(2), maxGrantsPerWeek: z.number().int().positive().default(8) })
    .prefault({}),
  /** One-off pack a Free account can buy at the limit. Null: no starter pack. */
  starterPack: z.object({ units: z.number().positive(), price: z.number().positive(), validityDays: z.number().int().positive().nullable().default(30) }).nullable().default(null),
  /** Paid trial offered at the Free limit. */
  paidTrial: z.object({ planId: z.string(), days: z.number().int().positive() }).nullable().default(null),
  dunning: z
    .object({
      graceDays: z.number().int().min(0).default(7),
      retryDays: z.array(z.number().int().min(0)).default([0, 1, 3, 5, 7]),
      preExpiryDays: z.number().int().positive().default(30),
    })
    .prefault({}),
  /** Paused accounts keep spending what they have, or have balances frozen until they resume. */
  pausePolicy: z.enum(["keep", "freeze"]).default("keep"),
  pauseMaxCycles: z.number().int().positive().default(3),
  annualDiscountPct: z.number().min(0).max(50).default(10),
  undoHours: z.number().int().positive().default(24),
  /** Extra included units a plan can add per meter, priced per block (plan-fit sliders). */
  expansion: z.record(z.string(), z.object({ step: z.number().positive(), price: z.number().nonnegative(), max: z.number().int().positive().default(8) })).default({}),
  benchmark: z.object({ costPerVerified: z.number().positive(), label: z.string() }).nullable().default(null),
  verifiedNoun: z.object({ one: z.string(), many: z.string() }).default({ one: "verified contact", many: "verified contacts" }),
  coupons: z.array(z.object({ code: z.string().min(3).max(24), label: z.string(), pctOff: z.number().min(0).max(100), months: z.number().int().positive().default(1) })).default([]),
  nudges: z.object({ maxNeverActivated: z.number().int().min(0).default(2), humanHelpDay: z.number().int().positive().default(7), quietDays: z.number().int().positive().default(14) }).prefault({}),
  /** Default sample table for new Free users. */
  templateTable: z.string().default("Starter table with 10 sample companies"),
});

/** Chargebee's own assistant and growth rules (Phases 4–5): CB Daily 5, the model catalog, autonomy, breakage funding. */
export const GrowthConfigSchema = z.object({
  assistant: z
    .object({
      models: z
        .array(
          z.object({
            id: z.enum(["lite", "swift", "deep"]),
            name: z.string(),
            speed: z.string(),
            depth: z.string(),
            /** Relative cost to serve, shown in the switcher. */
            relCost: z.string(),
            /** Lookups only, at no CB credit cost. */
            free: z.boolean().default(false),
          }),
        )
        .default([
          { id: "lite", name: "CB Lite", speed: "Instant", depth: "Lookups and short answers", relCost: "0.1×", free: true },
          { id: "swift", name: "CB Swift", speed: "Fast", depth: "Standard", relCost: "1×", free: false },
          { id: "deep", name: "CB Deep", speed: "Slower", depth: "Deep analysis and research", relCost: "4×", free: false },
        ]),
      daily: z
        .object({
          free: z.number().int().min(0).default(5),
          costs: z.object({ lookup: z.number().int().min(0).default(1), analysis: z.number().int().min(0).default(1), draft: z.number().int().min(0).default(2), research: z.number().int().min(0).default(3) }).prefault({}),
          bonuses: z.object({ guardrailLaunch: z.number().int().min(0).default(2), learning: z.number().int().min(0).default(1), dailyExperiment: z.number().int().min(0).default(2) }).prefault({}),
          pack: z.object({ credits: z.number().int().positive().default(20), price: z.number().nonnegative().default(10) }).prefault({}),
        })
        .prefault({}),
      autoGrantBudget: z.number().nonnegative().default(50),
      maxQuestions: z.number().int().min(0).max(5).default(5),
    })
    .prefault({}),
  breakage: z.object({ recognisedPct: z.number().min(0).max(100).default(80), fundingPct: z.number().min(0).max(100).default(25), promoExpiryDays: z.number().int().positive().default(7) }).prefault({}),
  holdout: z.object({ min: z.number().min(0).max(0.5).default(0.05), max: z.number().min(0).max(0.5).default(0.1) }).prefault({}),
  /** The population simulator runs a sample; the Workbench scales counts and revenue up to the tenant's base by this factor. */
  sampleScale: z.number().int().min(1).max(1000).default(25),
});
export type GrowthConfig = z.output<typeof GrowthConfigSchema>;

const Share = z.number().min(0).max(1);

/** The 90-day population simulator (Phase 1 §1.6). Every behaviour share is tunable here or in the Brain. */
export const SimSchema = z.object({
  workspaces: z.number().int().min(100).max(5000).default(2000),
  days: z.number().int().min(30).max(180).default(90),
  seed: z.number().int().default(1608),
  /** Kinds of work a workspace runs: the rate-card step it bills to, its share of runs and its outcome mix. */
  enrichments: z
    .array(
      z.object({
        id: Id,
        label: z.string().min(1).max(40),
        step: z.string(),
        share: Share,
        rowsMedian: z.number().positive(),
        outcomes: z.record(z.string(), Share),
        /** Model ids, default first. Most workspaces never change it. */
        models: z.array(z.string()).default([]),
        /** A model that bills to a different rate-card item, e.g. a cheaper research model. */
        modelSteps: z.record(z.string(), z.string()).default({}),
      }),
    )
    .min(1),
  outcomes: z.array(z.object({ id: Id, label: z.string(), charged: z.boolean() })).min(1),
  behaviours: z.object({
    churnAfter3Months: Share,
    addTopUps: Share,
    switchModels: Share,
    stayOnDefault: Share,
    freeGoQuiet: Share,
    freeNeverRun: Share,
  }),
  regions: z.record(z.string(), Share).default({ us: 0.55, eu: 0.3, in: 0.15 }),
  sources: z.record(z.string(), Share).default({ organic: 0.38, "paid-search": 0.2, referral: 0.16, partner: 0.1, outbound: 0.16 }),
});

const ExperimentSeedSchema = z.object({
  id: Id,
  name: z.string(),
  hypothesis: z.string(),
  cohort: z.string(),
  metric: z.string(),
  status: z.enum(["draft", "running", "done"]),
  owner: z.string(),
  startedDaysAgo: z.number().int().nonnegative().optional(),
  decision: z.enum(["ship", "iterate", "stop"]).optional(),
  arms: z.array(z.object({ name: z.string(), exposed: z.number().int().nonnegative(), converted: z.number().int().nonnegative() })),
});

export const TenantPackSchema = z.object({
  id: Id,
  company: z.string().min(1).max(40),
  category: z.string().min(1).max(80),
  billingModel: z.enum(["subscription", "prepaid"]).default("subscription"),
  /** Pricing archetype (Phase 8 Pack Builder). Informational: the billing behaviour comes from the fields below. */
  archetype: z.enum(["hybrid-credits", "subscription-credits", "prepaid-usage", "seat-plus-usage"]).optional(),
  /** Per-region override: false switches tax display off (the Pack lint flags it). */
  taxDisplay: z.record(z.string(), z.boolean()).default({}),
  workUnit: z.object({ one: z.string(), many: z.string() }),
  brand: z.object({
    wordmark: z.string().min(1).max(30),
    glyph: z.string().min(1).max(3),
    accent: z.object({ light: Color, dark: Color, foregroundLight: Color, foregroundDark: Color }),
  }),
  meters: z.array(MeterSchema).min(1).max(3),
  plans: z.array(PlanSchema).min(1),
  grantRules: z.array(GrantRuleSchema).min(1),
  topUpPacks: z.array(TopUpPackSchema).default([]),
  autoTopUp: z.object({ threshold: z.number().nonnegative(), amount: z.number().positive(), monthlySpendLimit: z.number().nonnegative() }),
  limits: z.object({
    spend: z.object({ selfSetCap: z.boolean(), tierCaps: z.boolean() }),
    rate: z.object({ runsPerMinute: z.number().int().positive(), agentRunsPerHour: z.number().int().positive() }),
  }),
  byokDiscount: z.object({ meter: Id, pct: z.number().min(0).max(100) }).nullable().default(null),
  /** Whether a balance may go below zero, and how far. Off by default: a blocked run says why instead. */
  ledgerPolicy: z.object({ allowNegative: z.boolean(), overdraft: z.number().min(0) }).default({ allowNegative: false, overdraft: 0 }),
  hub: HubConfigSchema.prefault({}),
  growth: GrowthConfigSchema.prefault({}),
  expansion: z.enum(["independent", "plan-only"]).default("plan-only"),
  rewards: z
    .array(z.object({ id: Id, label: z.string(), amount: z.number().positive(), meter: Id, expiryDays: z.number().int().positive().nullable().default(30), pending: z.string().optional() }))
    .default([]),
  moments: z.array(z.enum(MOMENT_IDS)).default([...MOMENT_IDS]),
  models: z.array(z.object({ id: Id, name: z.string(), provider: z.string(), providerCostPerRun: z.number().nonnegative(), default: z.boolean() })).default([]),
  regions: z.array(z.object({ id: Id, name: z.string(), residency: z.string() })).default([]),
  compliance: z.record(z.string(), z.boolean()).default({}),
  copy: z.record(z.string(), z.string().max(160)).default({}),
  rateCard: z.array(RateItemSchema).min(1),
  actionCost: z.number().nonnegative().default(0),
  saves: z.array(z.object({ id: Id, label: z.string(), detail: z.string() })).default([]),
  rules: z.object({
    hotPct: z.number().min(0).max(100),
    idlePct: z.number().min(0).max(100),
    byokHeavyPct: z.number().min(0).max(100),
    mcpHeavyPct: z.number().min(0).max(100),
    usageDropPct: z.number().min(0).max(100),
    alertPcts: z.array(z.number().min(1).max(100)),
    expiringSoonDays: z.number().int().positive().default(14),
  }),
  agents: z.object({
    mcpOnFree: z.boolean(),
    seatCap: z.number().nonnegative(),
    approvalOver: z.number().nonnegative(),
    premiumDataInAgents: z.boolean(),
    byokFee: z.number().nonnegative().default(0),
  }),
  demo: z.object({
    hub: z.object({ maya: HubPersonaDemoSchema, dev: HubPersonaDemoSchema }),
    merchantRoles: z.object({ nia: z.string(), sam: z.string() }),
    population: z.object({
      size: z.number().int().min(20).max(1000),
      seed: z.number().int(),
      cogsPerUnit: z.number().nonnegative(),
      unitsPerPrimary: z.number().positive().default(1),
      profiles: z.record(
        z.string(),
        z.object({ share: z.number().min(0).max(1), median: z.number().positive(), spread: z.number().min(0), secondary: z.number().min(0).default(1), base: z.number().positive().optional(), needs: z.record(z.string(), z.number().min(0).max(1)).default({}) }),
      ),
      names: z.tuple([z.array(z.string()).min(2), z.array(z.string()).min(2)]),
    }),
    experiments: z.array(ExperimentSeedSchema).default([]),
    sim: SimSchema.optional(),
  }),
});

export type TenantPack = z.output<typeof TenantPackSchema>;
export type Meter = TenantPack["meters"][number];
export type Plan = TenantPack["plans"][number];
export type GrantRule = TenantPack["grantRules"][number];
export type TopUpPack = TenantPack["topUpPacks"][number];
export type RateItem = TenantPack["rateCard"][number];
export type Workflow = z.output<typeof WorkflowSchema>;
export type HubPersonaDemo = z.output<typeof HubPersonaDemoSchema>;
export type HubConfig = z.output<typeof HubConfigSchema>;
export type TeamMemberSeed = z.output<typeof TeamMemberSchema>;
export type SeedExperiment = TenantPack["demo"]["experiments"][number];
export type MomentId = (typeof MOMENT_IDS)[number];
export type SimConfig = z.output<typeof SimSchema>;
export type WorkbenchTab = "start" | "today" | "overview" | "hypotheses" | "experiments" | "plays" | "ask" | "churn" | "optimiser" | "breakage" | "rewards" | "economics" | "controls" | "onboard" | "evals" | "mcp" | "agents" | "experiences" | "embed" | "packs";

export interface PackIssue {
  path: string;
  message: string;
}

/** Parse unknown JSON into a pack; issues name the JSON path that failed. */
export function parsePack(json: unknown): { ok: true; pack: TenantPack } | { ok: false; issues: PackIssue[] } {
  const r = TenantPackSchema.safeParse(json);
  if (r.success) {
    const cross = crossCheck(r.data);
    return cross.length ? { ok: false, issues: cross } : { ok: true, pack: r.data };
  }
  return { ok: false, issues: r.error.issues.slice(0, 20).map((i) => ({ path: i.path.join(".") || "(root)", message: i.message })) };
}

/** References between sections that a plain shape check cannot see. */
function crossCheck(p: TenantPack): PackIssue[] {
  const out: PackIssue[] = [];
  const meters = new Set(p.meters.map((m) => m.id));
  const plans = new Set(p.plans.map((x) => x.id));
  const rates = new Set(p.rateCard.map((r) => r.id));
  p.plans.forEach((pl, i) => Object.keys(pl.included).forEach((m) => !meters.has(m) && out.push({ path: `plans.${i}.included.${m}`, message: "Unknown meter" })));
  p.grantRules.forEach((g, i) => {
    if (!meters.has(g.meter)) out.push({ path: `grantRules.${i}.meter`, message: "Unknown meter" });
    if (g.plan !== "*" && !plans.has(g.plan)) out.push({ path: `grantRules.${i}.plan`, message: "Unknown plan" });
  });
  p.topUpPacks.forEach((t, i) => !meters.has(t.meter) && out.push({ path: `topUpPacks.${i}.meter`, message: "Unknown meter" }));
  p.rateCard.forEach((r, i) => Object.keys(r.costs).forEach((m) => !meters.has(m) && out.push({ path: `rateCard.${i}.costs.${m}`, message: "Unknown meter" })));
  (["maya", "dev"] as const).forEach((k) => {
    const d = p.demo.hub[k];
    if (!plans.has(d.planId)) out.push({ path: `demo.hub.${k}.planId`, message: "Unknown plan" });
    d.workflows.forEach((w, wi) => w.steps.forEach((s) => !rates.has(s) && out.push({ path: `demo.hub.${k}.workflows.${wi}.steps`, message: `Unknown rate-card item "${s}"` })));
  });
  Object.keys(p.demo.population.profiles).forEach((id) => !plans.has(id) && out.push({ path: `demo.population.profiles.${id}`, message: "Unknown plan" }));
  const sim = p.demo.sim;
  if (sim) {
    const outcomes = new Set(sim.outcomes.map((o) => o.id));
    const models = new Set(p.models.map((m) => m.id));
    sim.enrichments.forEach((e, i) => {
      if (!rates.has(e.step)) out.push({ path: `demo.sim.enrichments.${i}.step`, message: `Unknown rate-card item "${e.step}"` });
      Object.keys(e.outcomes).forEach((o) => !outcomes.has(o) && out.push({ path: `demo.sim.enrichments.${i}.outcomes.${o}`, message: "Unknown outcome" }));
      e.models.forEach((m) => !models.has(m) && out.push({ path: `demo.sim.enrichments.${i}.models`, message: `Unknown model "${m}"` }));
      Object.values(e.modelSteps).forEach((r) => !rates.has(r) && out.push({ path: `demo.sim.enrichments.${i}.modelSteps`, message: `Unknown rate-card item "${r}"` }));
    });
  }
  return out.slice(0, 20);
}
