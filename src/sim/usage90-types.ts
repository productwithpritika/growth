// Shapes produced by the 90-day population simulator (Phase 1 §1.6).
import type { SimConfig } from "@/tenants/schema";

export type ModelBehaviour = "default" | "switched" | "mixed";
export type WorkspaceStatus = "active" | "idle" | "quiet" | "churned" | "never-ran";
export type CohortDimension = "signupMonth" | "plan" | "region" | "source";
export const COHORT_DIMENSIONS: { id: CohortDimension; label: string }[] = [
  { id: "signupMonth", label: "Signup month" },
  { id: "plan", label: "Plan" },
  { id: "region", label: "Region" },
  { id: "source", label: "Acquisition source" },
];

export interface DailyRow {
  day: number; // 0 = first day of the window
  date: string; // ISO date
  active: number;
  signups: number;
  churned: number;
  runs: number;
  rows: number;
  credits: number; // primary meter
  byEnrichment: Record<string, number>; // credits
  outcomes: Record<string, number>; // rows
  modelRuns: Record<string, number>;
  providerCost: number; // USD
  subsRevenue: number; // USD
  topUpRevenue: number; // USD
  topUps: number;
  blocked: number;
}

export interface WorkspaceSummary {
  id: string;
  name: string;
  planId: string;
  region: string;
  source: string;
  signupDay: number; // relative to the window start; negative = signed up before it
  signupDate: string;
  status: WorkspaceStatus;
  model: ModelBehaviour;
  topUpper: boolean;
  seats: number;
  tables: number;
  runs: number; // in the window
  credits: number; // in the window
  revenue: number; // in the window
  topUps: number; // in the window
  blocked: number; // in the window
  firstRunDay: number | null;
  lastActiveDay: number | null;
  /** Active in month k after signup (index k), for k = 0…3. Null when the workspace is younger than that. */
  monthsActive: (boolean | null)[];
}

export interface CohortRow {
  key: string;
  label: string;
  workspaces: number;
  activatedPct: number;
  activeNowPct: number;
  churnedPct: number;
  topUpPct: number;
  switchedPct: number;
  avgCredits: number;
  revenue: number;
  arpu: number; // monthly, USD
  m1: number | null;
  m2: number | null;
  m3: number | null;
}

export type CohortTables = Record<CohortDimension, CohortRow[]>;

export interface SimTotals {
  workspaces: number;
  paid: number;
  activeNow: number;
  churnedInWindow: number;
  neverRan: number;
  quiet: number;
  runs: number;
  rows: number;
  credits: number;
  providerCost: number;
  subsRevenue: number;
  topUpRevenue: number;
  blocked: number;
  topUpBuyers: number;
  defaultModelShare: number; // share of model-choice runs left on the default (most expensive) model
}

export interface ModelUse {
  enrichment: string;
  model: string;
  runs: number;
  credits: number;
  providerCost: number;
  isDefault: boolean;
}

export type ChatIntent = "free-credits" | "discount" | "trial-extension" | "refund" | "startup-program" | "nonprofit-education" | "annual-prepay" | "regional-pricing";
export const CHAT_INTENTS: { id: ChatIntent; label: string }[] = [
  { id: "free-credits", label: "Free credits" },
  { id: "discount", label: "Discount" },
  { id: "trial-extension", label: "Trial extension" },
  { id: "refund", label: "Refund" },
  { id: "startup-program", label: "Startup programme" },
  { id: "nonprofit-education", label: "Nonprofit or education" },
  { id: "annual-prepay", label: "Annual prepay" },
  { id: "regional-pricing", label: "Regional pricing" },
];

export interface ChatTicket {
  id: string;
  workspaceId: string;
  workspaceName: string;
  planId: string;
  region: string;
  openedAt: string;
  intent: ChatIntent;
  signals: string[];
  sentiment: "frustrated" | "neutral" | "positive";
  outcome: string;
  messages: { from: "customer" | "agent"; text: string }[];
}

export interface SkillEndpoint {
  id: string;
  name: string;
  kind: "agent-skill" | "api";
  path: string;
  rateItem: string;
  models: string[];
}

export interface EvalSuite {
  id: string;
  skillId: string;
  name: string;
  cases: number;
  metric: string;
}

export interface EvalRun {
  id: string;
  suiteId: string;
  model: string;
  at: string;
  passRate: number;
  creditsPerCase: number;
  vsDefault: number;
}

export interface SimOutput {
  packId: string;
  config: SimConfig;
  anchor: string; // ISO date of the last window day
  windowStart: string;
  daily: DailyRow[];
  workspaces: WorkspaceSummary[];
  cohorts: CohortTables;
  totals: SimTotals;
  models: ModelUse[];
  chats: ChatTicket[];
  skills: SkillEndpoint[];
  suites: EvalSuite[];
  evalRuns: EvalRun[];
  hash: string;
  ms: number;
}

/** What the store keeps after a run: the config, its hash and the cohort tables. */
export interface PopulationRecord {
  config: SimConfig;
  anchor: string;
  hash: string;
  ranAt: string;
  totals: SimTotals;
  cohorts: CohortTables;
}
