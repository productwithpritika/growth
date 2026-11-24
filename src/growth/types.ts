// Shapes for Phases 3–5: agentic onboarding and the tour, Ask CB, and the Growth Workbench loop
// (hypotheses, experiments, scorecards, breakage pool, rewards studio). All of it lives on
// TenantState.growth so it persists, resets and switches tenant with everything else.
import type { ToolCall } from "@/mcp/types";
import type { Tone } from "@/core/types";

// ---------------------------------------------------------------- onboarding (Phase 3)

export type SourceId = "billing" | "usage" | "policy" | "providers" | "analytics" | "helpchat";
export type LaneId = "policy" | "customers" | "pricing" | "features" | "models" | "behaviour" | "helpchat";
export type LaneStatus = "queued" | "connecting" | "reading" | "understanding" | "needs-you" | "done" | "skipped" | "failed";
export type Confidence = "high" | "medium" | "low";
export type ConnectorState = "native" | "off" | "connecting" | "slow" | "failed" | "connected" | "partial" | "fallback" | "forgotten";
export type DrillId = "source-fails" | "partial-data" | "slow-connector" | "no-policy-region" | "withdraw-consent";

export interface LaneRun {
  id: LaneId;
  status: LaneStatus;
  /** 0–1 through reading and understanding. */
  progress: number;
  /** Records read so far. */
  count: number;
  /** Memory card ids learned so far, in order. */
  chips: string[];
  note: string | null;
  partial: boolean;
  startedAt: number | null;
  doneAt: number | null;
}

export interface MemoryCard {
  id: string;
  lane: LaneId;
  title: string;
  value: string;
  source: string;
  confidence: Confidence;
  updatedAt: string;
  edited: boolean;
  forgotten: boolean;
  history: { at: string; by: string; from: string; to: string }[];
}

export interface QuestionState {
  id: string;
  lane: LaneId;
  status: "waiting" | "asked" | "answered" | "skipped";
  answer: string | null;
  at: string | null;
}

export interface OnboardingState {
  stage: "consent" | "ingest" | "reveal" | "done";
  sessionId: string;
  sources: Record<SourceId, boolean>;
  connectors: Record<SourceId, ConnectorState>;
  lanes: LaneRun[];
  /** Simulated seconds since Connect: the Time to first experiment clock. */
  simSeconds: number;
  connectedAt: string | null;
  questions: QuestionState[];
  drills: DrillId[];
  speed: number;
  paused: boolean;
  revealSeenAt: number | null;
  /** Real time when ingestion finished: after it the clock runs at real speed. */
  realSince: string | null;
  firstExperimentAt: number | null;
  firstExperimentId: string | null;
}

export interface TelemetryEvent {
  id: string;
  ts: string;
  /** Simulated seconds since Connect, when the event belongs to onboarding or the tour. */
  sim: number | null;
  session: string;
  persona: string;
  kind: "consent" | "connector" | "lane" | "question" | "card" | "reveal" | "tour" | "command" | "click" | "ask" | "experiment" | "cb";
  name: string;
  detail: string;
}

// ---------------------------------------------------------------- tour (Phase 3.5)

export type TourStepId = "open-cohorts" | "select-cohort" | "ask-why" | "hypotheses" | "pick" | "draft" | "scorecard" | "approval" | "launch";

export interface TourSandbox {
  lab: LabExperiment[];
  threads: CbThread[];
  audiences: Audience[];
}

export interface TourState {
  status: "idle" | "running" | "paused" | "done" | "exited";
  step: number;
  control: "agent" | "you";
  completed: { id: TourStepId; by: "agent" | "you"; at: string }[];
  picked: string | null;
  draftId: string | null;
  threadId: string | null;
  previewed: boolean;
  approvalOpen: boolean;
  launchedId: string | null;
  voice: boolean;
  reducedMotion: boolean;
  startedAt: string | null;
  sessionId: string;
  sandbox: TourSandbox | null;
}

// ---------------------------------------------------------------- Ask CB (Phase 4)

export type CbScope = "merchant" | "enduser";
export type CbModelId = "auto" | "lite" | "swift" | "deep";
export type TaskKind = "lookup" | "analysis" | "draft" | "research";
export type Workflow = "grants" | "offers" | "experiments" | "dunning";
export type Autonomy = "suggest" | "draft" | "execute" | "auto";

export interface DiffRowLite {
  path: string;
  before: string;
  after: string;
}

export type Block =
  | { kind: "kv"; title?: string; rows: [string, string][] }
  | { kind: "table"; title?: string; columns: string[]; rows: string[][]; numeric?: number[] }
  | { kind: "bars"; title?: string; items: { label: string; value: number; display: string; tone?: Tone }[] }
  | { kind: "series"; title?: string; yLabel: string; points: { x: string; y: number }[] }
  | { kind: "hypotheses"; ids: string[]; recommended: string; items: HypothesisLite[] }
  | { kind: "scorecard"; expId: string }
  | { kind: "plan-diff"; title?: string; rows: DiffRowLite[] }
  | { kind: "research"; plan: string[]; sections: { heading: string; text: string; cites: string[] }[] }
  | { kind: "commands"; items: { name: string; args: string; help: string }[] }
  | { kind: "memory"; ids: string[] };

export interface HypothesisLite {
  id: string;
  rank: number;
  title: string;
  observation: string;
  intervention: string;
  effect: string;
  confidence: Confidence;
}

export interface Chip {
  label: string;
  /** Designed-moment actions (CB Daily 5 empty state). */
  action?: "wait" | "lite" | "buy";
  /** Sends this as the next message. */
  prompt?: string;
  /** Opens a Workbench tab. */
  tab?: string;
}

export type WritePayload =
  | { kind: "grant"; account: "maya" | "dev"; meter: string; amount: number; note: string }
  | { kind: "offer"; audience: string; audienceLabel: string; size: number; offer: string; pctOff: number; months: number; expiresDays: number }
  | { kind: "experiment"; spec: ExperimentSpec }
  | { kind: "undo"; auditId: string }
  | { kind: "request"; account: "maya" | "dev"; meter: string; amount: number; reason: string };

export interface WriteProposal {
  id: string;
  workflow: Workflow;
  title: string;
  summary: string;
  diff: DiffRowLite[];
  risk: { level: "low" | "medium" | "high"; reasons: string[] };
  costUsd: number;
  payload: WritePayload;
  status: "proposed" | "approved" | "auto" | "rejected" | "drafted" | "suggested";
  auditId: string | null;
}

export type CbStatus = "ok" | "clarify" | "declined" | "empty" | "error" | "timeout" | "rate-limited" | "out-of-credits";

export interface CbMessage {
  id: string;
  role: "user" | "assistant";
  ts: string;
  text: string;
  command?: string;
  via?: "typed" | "voice" | "chip" | "palette" | "tour";
  model?: Exclude<CbModelId, "auto">;
  autoReason?: string;
  task?: TaskKind;
  cost?: number;
  status?: CbStatus;
  evidence?: string[];
  confidence?: Confidence;
  blocks?: Block[];
  trace?: ToolCall[];
  cites?: string[];
  chips?: Chip[];
  clarify?: { question: string; options: Chip[] };
  write?: WriteProposal;
  intent?: string;
  /** The live model answered instead of the scripted library. */
  live?: boolean;
}

export interface CbThread {
  id: string;
  scope: CbScope;
  persona: string;
  title: string;
  model: CbModelId;
  mode: "chat" | "research";
  createdAt: string;
  messages: CbMessage[];
  sandbox?: boolean;
}

export interface CbAllowance {
  day: string;
  used: number;
  bonus: { at: string; reason: string; amount: number }[];
  bought: number;
  log: { at: string; amount: number; reason: string; thread: string | null }[];
}

export interface GrowthAudit {
  id: string;
  ts: string;
  actor: string;
  workflow: Workflow | "experiments" | "levers" | "breakage" | "rewards" | "onboarding" | "memory";
  what: string;
  decision: "approved" | "auto" | "rejected" | "drafted" | "undone" | "recorded";
  thread: string | null;
  message: string | null;
  diff: DiffRowLite[];
  undo?: { kind: "grant"; account: "maya" | "dev"; entryId: string } | { kind: "experiment"; id: string } | { kind: "offer"; id: string } | null;
}

export interface PlaybookEntry {
  id: string;
  ts: string;
  title: string;
  question: string;
  sections: { heading: string; text: string; cites: string[] }[];
  by: string;
}

export interface OfferDraft {
  id: string;
  ts: string;
  audience: string;
  audienceLabel: string;
  size: number;
  offer: string;
  pctOff: number;
  months: number;
  expiresDays: number;
  status: "draft" | "live" | "withdrawn";
  thread: string | null;
}

// ---------------------------------------------------------------- Workbench loop (Phase 5)

export type InterventionType = "reward-rule" | "nudge-copy" | "offer" | "topup-price" | "packaging" | "cancel-save" | "estimator-default" | "model-default";
export type LabStatus = "draft" | "approved" | "running" | "paused" | "readout" | "shipped" | "killed" | "reverted";
export type Verdict = "Too early" | "Directional" | "Ship" | "Hold" | "Kill";

export interface Guardrail {
  id: "refunds" | "tickets" | "margin" | "complaints" | "quality" | "rerun";
  label: string;
  /** Worst acceptable change versus control, in percentage points of the rate (margin: points of gross margin). */
  maxWorsePts: number;
}

export interface ArmDay {
  exposed: number;
  engaged: number;
  intent: number;
  runs: number;
  burn: number;
  topUpStarts: number;
  converted: number;
  retained: number;
  revenue: number;
  credits: number;
  cost: number;
  refunds: number;
  tickets: number;
  complaints: number;
  /** Model-switch experiments only: runs re-run by the user, and runs reported as low quality. */
  rerun?: number;
  lowQuality?: number;
}

export interface LabDay {
  day: number;
  date: string;
  control: ArmDay;
  variant: ArmDay;
}

export interface PackPatch {
  path: string;
  before: unknown;
  after: unknown;
  label: string;
}

export interface ExperimentSpec {
  name: string;
  hypothesis: string;
  intervention: { type: InterventionType; detail: string; variant: string };
  audience: { id: string; label: string; size: number };
  allocation: number;
  holdout: number;
  metric: string;
  metrics: string[];
  baseRate: number;
  mde: number;
  layer: string;
  guardrails: Guardrail[];
  origin: "tour" | "hypothesis" | "play" | "manual" | "seed" | "ask" | "optimiser" | "rewards";
  sourceId: string | null;
  newCustomersOnly: boolean;
  patches: PackPatch[];
  /** Prior on the true relative lift, from the simulator. */
  prior: [number, number];
  /** Phase 6: an experiment that changes the model behind an AI skill needs a passing eval. */
  skill?: { id: string; from: string; to: string };
}

export interface LabExperiment extends ExperimentSpec {
  id: string;
  status: LabStatus;
  owner: string;
  createdAt: string;
  approvedAt: string | null;
  launchedAt: string | null;
  endedAt: string | null;
  pausedReason: string | null;
  days: LabDay[];
  /** Hidden truth the simulator draws outcomes from. */
  truth: { lift: number; guard: Partial<Record<Guardrail["id"], number>> };
  decision: { verdict: Verdict; by: string; at: string; note: string } | null;
  thread: string | null;
  sandbox?: boolean;
}

export interface Hypothesis {
  id: string;
  day: string;
  observation: string;
  hypothesis: string;
  effect: [number, number];
  metric: string;
  audience: { id: string; label: string; size: number };
  intervention: { type: InterventionType; detail: string; variant: string };
  guardrails: string[];
  effort: "S" | "M" | "L";
  risk: "low" | "medium" | "high";
  confidence: Confidence;
  layer: string;
  baseRate: number;
  score: number;
  why: string;
  cards: string[];
}

export interface Learning {
  id: string;
  ts: string;
  title: string;
  hypothesis: string;
  outcome: "shipped" | "killed" | "held" | "paused";
  lift: number | null;
  note: string;
  experimentId: string | null;
}

export interface Audience {
  id: string;
  ts: string;
  label: string;
  segment: string;
  size: number;
  slice: string;
}

export interface RewardRule {
  id: string;
  label: string;
  action: string;
  amount: number;
  meter: string;
  capPerMonth: number;
  expiryDays: number;
  eligibility: string;
  funding: "breakage" | "marketing" | "plan";
  status: "draft" | "testing" | "live" | "off";
  createdAt: string;
}

export interface BreakageCommit {
  id: string;
  ts: string;
  kind: "upsell" | "nudge" | "reward";
  label: string;
  accounts: number;
  credits: number;
  usd: number;
  expiresDays: number;
}

export interface GrowthState {
  /** The population window the Workbench reads (fixed at seed so the time machine stays fast). */
  anchor: string;
  onboarding: OnboardingState;
  memory: MemoryCard[];
  telemetry: TelemetryEvent[];
  tours: Record<string, TourState>;
  lab: LabExperiment[];
  hypotheses: { day: string; picked: string | null; launched: string | null; history: { day: string; ids: string[]; picked: string | null; launched: string | null }[] };
  learnings: Learning[];
  audiences: Audience[];
  ask: { threads: CbThread[]; provider: "scripted" | "live"; drill: "none" | "error" | "timeout" | "rate-limit" };
  cb: Record<string, CbAllowance>;
  autonomy: Record<Workflow, Autonomy>;
  autoSpend: { day: string; grants: number };
  audit: GrowthAudit[];
  playbook: PlaybookEntry[];
  offers: OfferDraft[];
  breakage: { recognisedPct: number; fundingPct: number; commits: BreakageCommit[] };
  rewardRules: RewardRule[];
  levers: { graceCredits: boolean; retry: "standard" | "smart" | "short"; message: "plain" | "loss" | "helpful"; backupPrompt: boolean; graceDays: number };
  rescued: string[];
  grandfathering: "12-months" | "renewal-credit" | "migrate-now";
}
