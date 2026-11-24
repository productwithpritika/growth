// Phases 6–8 state: Bring Your Own Evals, the governed MCP tool layer, agents, portal
// experiences, the embed SDK, feature flags and releases. Lives on TenantState.platform.

// ------------------------------------------------------------------ Phase 6: evals

export type SuiteId = "accuracy" | "rubric" | "schema" | "latency" | "cost" | "robustness" | "refusal" | "contact";
export type GateState = "pass" | "warn" | "fail" | "none";

export interface SkillManifest {
  id: string;
  name: string;
  description: string;
  transport: "mcp" | "http";
  endpoint: string;
  input: Record<string, string>;
  output: Record<string, string>;
  /** Meter mapping: what one call bills, at the default model. */
  meter: { dataCredits: number; actions: number };
  defaultModel: string;
  allowedModels: string[];
  timeoutMs: number;
  /** Evals need read-only skills. */
  sideEffects: boolean;
  pii: "none" | "masked" | "contains-pii";
  idempotent: boolean;
  rateLimitPerMin: number;
}

export interface Check {
  id: string;
  label: string;
  ok: boolean;
  detail: string;
}

export interface Skill {
  id: string;
  manifest: SkillManifest;
  status: "live" | "draft";
  registeredAt: string;
  /** Secrets never leave the vault: only a reference and a fingerprint are kept. */
  vault: { ref: string; fingerprint: string } | null;
  checks: Check[];
  /** The model in production today (the manifest default unless a switch shipped). */
  inUse: string;
}

export interface Dataset {
  id: string;
  skillId: string;
  name: string;
  source: "upload" | "sample" | "synthetic";
  rows: number;
  columns: string[];
  golden: boolean;
  region: string;
  retentionDays: number;
  createdAt: string;
  /** Columns masked on the way in. */
  masked: string[];
  description: string;
  /** A few masked rows for the drill-down; the full file is never stored. */
  preview: string[][];
}

export interface RubricCriterion {
  id: string;
  label: string;
  weight: number;
}

export interface EvalRun {
  id: string;
  skillId: string;
  datasetId: string;
  models: string[];
  suites: SuiteId[];
  repeats: number;
  at: string;
  /** The isolated synthetic tenant the run provisioned. */
  sandboxTenant: string;
  credits: number;
  by: string;
  rubric: RubricCriterion[];
  trigger: "manual" | "scheduled" | "provider-change" | "agent";
}

export interface GateOverride {
  id: string;
  skillId: string;
  model: string;
  experimentId: string | null;
  reason: string;
  requestedBy: string;
  status: "pending" | "approved" | "rejected";
  decidedBy: string | null;
  at: string;
}

export interface ProviderChange {
  id: string;
  model: string;
  at: string;
  note: string;
  /** Quality points added to every skill on this model from `at` on. */
  drift: Record<string, number>;
}

export interface EvalAlert {
  id: string;
  at: string;
  skillId: string;
  model: string;
  text: string;
  severity: "watch" | "blocked";
  /** Routed to Ask CB as a thread prompt. */
  routed: boolean;
}

export interface CanaryReading {
  date: string;
  quality: number;
}

export interface EvalsState {
  skills: Skill[];
  datasets: Dataset[];
  runs: EvalRun[];
  overrides: GateOverride[];
  budget: { monthly: number };
  /** Non-inferiority margin in quality points. */
  margin: number;
  rubrics: Record<string, RubricCriterion[]>;
  providerChanges: ProviderChange[];
  alerts: EvalAlert[];
  schedule: Record<string, "daily" | "weekly" | "on-change">;
  canary: Record<string, CanaryReading[]>;
  /** Default-model changes that shipped outside an experiment. */
  defaults: { skillId: string; from: string; to: string; at: string; by: string; override: string | null }[];
}

// ------------------------------------------------------------------ Phase 7: MCP, agents, moments, embed

export type ToolTier = "read" | "draft" | "approval";
export type Tier = "read" | "draft" | "approval" | "auto";

export interface FieldConstraint {
  hidden?: boolean;
  default?: string | number | boolean;
  min?: number;
  max?: number;
}

export interface Principal {
  id: string;
  label: string;
  kind: "human" | "agent" | "external" | "assistant";
  role: "viewer" | "analyst" | "operator" | "automation";
  tier: Tier;
  tenant: string;
  /** Servers this token may call. */
  servers: string[];
  /** Customer-scoped tokens see one account only. */
  account: "maya" | "dev" | null;
  rateLimitPerMin: number;
  fingerprint: string;
  createdAt: string;
  revoked: boolean;
}

export type CallOutcome = "ok" | "draft" | "pending" | "executed" | "denied" | "dry-run" | "replayed";

export interface McpActivity {
  id: string;
  ts: string;
  /** Wall-clock ms, for rate limits. */
  wall: number;
  principal: string;
  principalLabel: string;
  tool: string;
  server: string;
  tier: ToolTier;
  args: Record<string, unknown>;
  prompt: string;
  outcome: CallOutcome;
  reason: string;
  approver: string | null;
  approvalId: string | null;
  idempotencyKey: string | null;
  dryRun: boolean;
  ms: number;
  summary: string;
  result: unknown;
}

export interface McpApproval {
  id: string;
  ts: string;
  tool: string;
  args: Record<string, unknown>;
  principal: string;
  principalLabel: string;
  prompt: string;
  status: "pending" | "approved" | "rejected";
  decidedBy: string | null;
  decidedAt: string | null;
  activityId: string;
  idempotencyKey: string | null;
}

export interface McpBudgets {
  creditsPerDay: number;
  spendPerDay: number;
  concurrentExperiments: number;
  /** Who approved the standing budget that lets "Auto within budget" execute. */
  approvedBy: string;
}

export interface McpState {
  killSwitch: boolean;
  constraints: Record<string, Record<string, FieldConstraint>>;
  principals: Principal[];
  activity: McpActivity[];
  approvals: McpApproval[];
  budgets: McpBudgets;
  /** Granted or spent today under standing budgets. */
  spent: { day: string; credits: number; usd: number };
}

export type AgentId = "onboarding" | "coach" | "concierge" | "dunning" | "hypothesis" | "operator" | "eval" | "winback" | "sentinel";

export interface AgentRun {
  id: string;
  agent: AgentId;
  ts: string;
  trigger: string;
  activity: string[];
  text: string;
}

export interface AgentsState {
  paused: Record<string, boolean>;
  runs: AgentRun[];
}

export type MomentTrigger = { metric: "forecast_runout_days" | "balance_pct" | "payment_failed" | "plan_cap_hit"; op: "<" | ">"; value: number; meter: string };

export interface MomentDef {
  id: string;
  version: number;
  name: string;
  trigger: MomentTrigger;
  audience: { plans: string[] };
  blocks: { kind: "headline" | "body"; text: string }[];
  primaryAction: { label: string; action: "open-topups" | "open-plan" | "open-billing" | "open-usage" };
  frequencyCap: { count: number; per: "day" | "week" | "month" };
  experiment: { enabled: boolean; holdout: number };
  locales: string[];
  tone: "watch" | "info" | "reward" | "atRisk";
}

export interface PortalMoment {
  id: string;
  prompt: string;
  versions: MomentDef[];
  /** The published version number, or null. */
  live: number | null;
  /** Shown in the Credits Hub as a preview (draft version). */
  previewing: boolean;
  pending: { version: number; approvalId: string } | null;
  history: { ts: string; action: "drafted" | "previewed" | "requested" | "published" | "rolled-back" | "unpublished" | "rejected"; by: string; version: number }[];
}

export interface EmbedState {
  modules: string[];
  mode: "drawer" | "modal";
  hosting: "embedded" | "hosted";
  hooks: string[];
  events: { ts: string; name: string; detail: string }[];
}

// ------------------------------------------------------------------ Phase 8: flags, releases, privacy

export interface FlagState {
  rollout: number;
  killed: boolean;
}

export interface Release {
  id: string;
  tier: 1 | 2 | 3;
  title: string;
  module: string;
  status: "planned" | "in-review" | "rolling-out" | "shipped";
  rollout: number;
  signoffs: Record<string, boolean>;
  at: string;
}

export interface PlatformState {
  evals: EvalsState;
  mcp: McpState;
  agents: AgentsState;
  portal: { moments: PortalMoment[] };
  embed: EmbedState;
  flags: Record<string, FlagState>;
  releases: Release[];
  /** Deletions done for retention or on request: what and when, never the content. */
  deletions: { ts: string; what: string; by: string }[];
}
