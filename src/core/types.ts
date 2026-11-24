// Shared shapes for the brain: ledger, event stream, customer accounts and tenant state.
import type { HubPersonaDemo, SeedExperiment, TenantPack } from "@/tenants/schema";
import type { BlockReason } from "@/core/block";
import type { PopulationRecord } from "@/sim/usage90-types";
import type { GrowthState } from "@/growth/types";
import type { PlatformState } from "@/platform/types";

export type Tone = "healthy" | "watch" | "atRisk" | "blocked" | "reward" | "info" | "neutral";
export type Policy = "today" | "cockpit";

/** The seven immutable entry kinds. Corrections are reversals, never edits. */
export type LedgerKind = "grant" | "debit" | "hold" | "release" | "rollover" | "expiry" | "reversal";
export const LEDGER_KINDS: LedgerKind[] = ["grant", "debit", "hold", "release", "rollover", "expiry", "reversal"];

/** Where granted credits came from. Spend order reads this: reward and promo first, then plan and rollover by expiry, then top-ups. */
export type GrantSource = "plan" | "rollover" | "topup" | "reward" | "promo";
export const GRANT_SOURCES: GrantSource[] = ["plan", "rollover", "topup", "reward", "promo"];

export type ReasonCode =
  | "plan.monthly"
  | "plan.daily"
  | "plan.proration"
  | "topup.purchase"
  | "topup.auto"
  | "topup.recovered"
  | "reward.claimed"
  | "reward.spark"
  | "reward.activation"
  | "reward.badge"
  | "promo.goodwill"
  | "credits.request"
  | "topup.starter"
  | "topup.refund"
  | "usage.run"
  | "usage.over-hold"
  | "hold.placed"
  | "hold.settled"
  | "rollover.opening"
  | "rollover.carry"
  | "expiry.lot"
  | "expiry.cycle-close"
  | "correction";

export interface LedgerEntry {
  seq: number;
  id: string;
  ts: string;
  account: string;
  meter: string;
  kind: LedgerKind;
  /** Set on grant and rollover entries (and on reversals of them). */
  source: GrantSource | null;
  amount: number;
  balance: number;
  reason: ReasonCode;
  /** Who caused it: "system:scheduler", "user:maya", "merchant:nia", "agent:onboarding". */
  actor: string;
  /** Posting the same key twice returns the first entry instead of a duplicate. */
  idempotencyKey: string;
  eventId: string | null;
  note: string;
  expiresAt: string | null;
  holdId: string | null;
  /** Expiry and cycle-close entries name the lot (grant entry id) they remove. */
  lotId: string | null;
  /** Reversals name the entry they offset. */
  reverses: string | null;
  prev: string;
  hash: string;
}

export type EventStatus = "ok" | "stopped" | "blocked" | "failed" | "info";

export interface UsageEvent {
  seq: number;
  id: string;
  ts: string;
  account: string;
  type: string;
  workflow?: string;
  step?: string;
  channel?: string;
  units?: number;
  done?: number;
  meters?: Record<string, number>;
  limitedBy?: string;
  reason?: BlockReason;
  /** Team member who ran it (member id), for usage by member and member limits. */
  member?: string;
  /** Table run this usage belongs to (Credits Hub tables). */
  runId?: string;
  /** Found, verified and retried rows for this step, when the run knows them. */
  found?: number;
  verified?: number;
  retries?: number;
  status: EventStatus;
  note: string;
}

export interface Charge {
  id: string;
  ts: string;
  amount: number;
  description: string;
  status: "paid" | "failed" | "recovered" | "refunded";
  meter?: string;
  units?: number;
  reason?: string;
}

export type TeamRole = "admin" | "billing" | "member";
export interface TeamMember {
  id: string;
  name: string;
  title: string;
  role: TeamRole;
  persona?: boolean;
}

/** A spend or usage limit on a member, a table or the whole workspace, per meter, per cycle. */
export interface SpendLimit {
  id: string;
  scope: "member" | "table" | "workspace";
  /** Member id, table (workflow) id, or "workspace". */
  target: string;
  meter: string;
  amount: number;
  behaviour: "warn" | "block";
}

export interface CreditRequest {
  id: string;
  ts: string;
  from: string;
  fromName: string;
  meter: string;
  amount: number;
  usd: number;
  reason: string;
  status: "pending" | "approved" | "declined";
  decidedAt: string | null;
  decidedBy: string | null;
  note: string | null;
}

export interface AuditEntry {
  id: string;
  ts: string;
  actor: string;
  area: "limits" | "roles" | "auto top-up" | "plan" | "billing" | "requests" | "alerts" | "rewards" | "subscription";
  what: string;
  from: string | null;
  to: string | null;
}

/** A simulated outbound notification: e-mail, team chat or in-app. */
export interface Notice {
  id: string;
  ts: string;
  channel: "email" | "chat" | "inapp";
  to: string;
  subject: string;
  body: string;
  action: string | null;
}

export type TableRunStatus = "running" | "paused" | "waiting" | "done" | "stopped";

/** One enrichment column run over a table, row by row, against a hold. */
export interface TableRun {
  id: string;
  tableId: string;
  table: string;
  stepId: string;
  column: string;
  byok: boolean;
  rows: number;
  done: number;
  found: number;
  verified: number;
  notFound: number;
  retries: number;
  status: TableRunStatus;
  holdId: string | null;
  /** Credits reserved by the current hold, and drawn from it so far. */
  held: Record<string, number>;
  drawn: Record<string, number>;
  /** Totals over every segment of the run. */
  used: Record<string, number>;
  released: Record<string, number>;
  member: string;
  startedAt: string;
  updatedAt: string;
  pausedReason: BlockReason | null;
  resumeAt: string | null;
  segments: number;
  /** Limits that warned during the run (scope · target). */
  warnings: string[];
}

export interface PaymentAttempt {
  at: string;
  method: string;
  outcome: "failed" | "paid" | "scheduled" | "skipped";
  note: string;
}

/** Renewal payment health: soft landing while it recovers. */
export interface DunningState {
  status: "ok" | "grace" | "recovered" | "suspended";
  invoiceId: string | null;
  amount: number;
  failedAt: string | null;
  graceUntil: string | null;
  attempts: PaymentAttempt[];
}

export interface PlanChange {
  id: string;
  at: string;
  from: string;
  to: string;
  billing: "monthly" | "annual";
  addOns: Record<string, number>;
  effective: "now" | "renewal";
  chargeId: string | null;
  amount: number;
  entryIds: string[];
  undoUntil: string;
  undone: boolean;
  prev: { planId: string; nextPlanId: string | null; billing: "monthly" | "annual"; addOns: Record<string, number> };
}

export interface RewardState {
  /** Days (YYYY-MM-DD) with a qualifying action. */
  sparkDays: string[];
  sparkGranted: { day: string; entryId: string; amount: number }[];
  badges: { id: string; at: string; entryId: string | null }[];
  activatedAt: string | null;
  domainVerified: boolean;
  /** Grants the anti-abuse rules refused, with the rule. */
  refused: { at: string; what: string; rule: string }[];
}

export interface LifecycleState {
  signedUpAt: string;
  nudges: { at: string; kind: string }[];
  optOut: boolean;
  convertedAt: string | null;
}

export interface ShareLink {
  id: string;
  ts: string;
  days: number;
  by: string;
  expiresAt: string;
  revoked: boolean;
}

export interface BillingProfile {
  company: string;
  address: { line1: string; city: string; postcode: string; country: string };
  taxId: string | null;
  email: string;
  coupons: { code: string; label: string; pctOff: number; appliedAt: string; months: number }[];
  billing: "monthly" | "annual";
  /** Extra included blocks per meter (plan-fit sliders). */
  addOns: Record<string, number>;
}

export interface PauseState {
  at: string;
  policy: "keep" | "freeze";
  until: string;
}

export interface ExitSurvey {
  id: string;
  ts: string;
  account: string;
  plan: string;
  reason: string;
  offer: string | null;
  outcome: "accepted" | "declined" | "kept" | "cancelled";
}

export interface HubAccountState {
  planId: string;
  nextPlanId: string | null;
  status: "active" | "paused" | "cancelling";
  cancelReason: string | null;
  card: HubPersonaDemo["card"];
  autoTopUp: HubPersonaDemo["autoTopUp"];
  autoTopUpHalted: boolean;
  topUpCap: number;
  budgets: Record<string, number | null>;
  mcpCap: number | null;
  alerts: Record<string, boolean>;
  alertsSent: string[];
  rewards: string[];
  charges: Charge[];
  dismissed: Record<string, string>;
  /** Billing region pack id (us, eu, in): currency, tax display and payment prompts. */
  region: string;
  /** Recurring-payment consent given for auto top-up, per region. */
  consents: Record<string, { at: string; maxPerCharge: number | null }>;
  backupCard: HubPersonaDemo["card"] | null;
  team: TeamMember[];
  limits: SpendLimit[];
  requests: CreditRequest[];
  audit: AuditEntry[];
  notices: Notice[];
  alertChannels: Record<"email" | "chat" | "inapp", boolean>;
  runs: TableRun[];
  dunning: DunningState;
  planChange: PlanChange | null;
  rewardState: RewardState;
  lifecycle: LifecycleState;
  shares: ShareLink[];
  profile: BillingProfile;
  pause: PauseState | null;
  /** Set when auto top-up met the cap with "ask": the admin can allow one more pack. */
  capAsk: { at: string; usd: number } | null;
}

export interface Experiment extends Omit<SeedExperiment, "startedDaysAgo"> {
  startedAt: string | null;
}

export interface Approval {
  id: string;
  ts: string;
  title: string;
  actor: string;
  decision: "approved" | "rejected";
  risk: "low" | "medium" | "high";
  summary: string;
}

export interface TenantState {
  packId: string;
  custom: boolean;
  clock: string;
  cycleStart: string;
  cycleNo: number;
  tick: number;
  pack: TenantPack;
  ledger: LedgerEntry[];
  events: UsageEvent[];
  hub: Record<string, HubAccountState>;
  experiments: Experiment[];
  saves: Record<string, string>;
  approvals: Approval[];
  /** The last 90-day population run: its config, output hash and persisted cohort tables. */
  population?: PopulationRecord;
  /** Cancel and pause reasons with the offer shown and what happened: data for the Workbench. */
  exitSurveys: ExitSurvey[];
  /** Phases 3–5: onboarding, the tour, Ask CB and the Growth Workbench loop. */
  growth: GrowthState;
  /** Phases 6–8: evals, the MCP tool layer, agents, portal experiences, embed, flags and releases. */
  platform: PlatformState;
}

export interface Account {
  id: string;
  name: string;
  planId: string;
  demand: Record<string, number>;
  prev: Record<string, number>;
  carry: Record<string, number>;
  units: number;
  signupWeek: number;
  needs: string[];
  byok: number;
  mcp: number;
  paymentFailed: boolean;
  cancelIntent: boolean;
  cogsPerUnit: number;
}

export interface Insight {
  id: string;
  surface: "hub" | "workbench";
  persona?: string;
  tone: Tone;
  title: string;
  source: string;
}
