// The domain model (Phase 1 §1.4). Every entity the cockpit talks about, with the shape it has
// here and where it lives: in the Tenant Pack (config), the ledger and event stream (state),
// the 90-day population (simulated history) or derived on read. `domainCatalog` counts each
// one for the active tenant so the Brain can show the model as live data, not a diagram.
import type { Meter as PackMeter, Plan as PackPlan, TenantPack } from "@/tenants/schema";
import type { Approval, Experiment as StoredExperiment, GrantSource, Insight, LedgerEntry as StoredLedgerEntry, TenantState, UsageEvent as StoredUsageEvent } from "@/core/types";
import type { ChatTicket as SimChatTicket, EvalRun as SimEvalRun, EvalSuite as SimEvalSuite, SimOutput, SkillEndpoint as SimSkillEndpoint } from "@/sim/usage90-types";
import { holdsOf, lotsOf } from "@/core/ledger";
import { HUB_PERSONAS } from "@/tenants/personas";
import { workbenchInsights, hubInsights } from "@/core/insights";
import { cohortDefs } from "@/core/economics";

// ---- Tenancy
export interface Tenant {
  id: string;
  company: string;
  category: string;
  billingModel: TenantPack["billingModel"];
  regions: string[];
}
export interface Workspace {
  id: string;
  tenantId: string;
  name: string;
  planId: string;
  region: string;
  source: string;
  signupAt: string;
  status: "active" | "idle" | "quiet" | "churned" | "never-ran";
}
export interface User {
  id: string;
  workspaceId: string | null; // null for the tenant's own staff
  name: string;
  role: "owner" | "admin" | "member" | "merchant";
}

// ---- Pricing (from the Tenant Pack)
export type Plan = PackPlan;
export type Meter = PackMeter;
export interface CreditGrant {
  id: string; // the ledger entry that created it
  workspaceId: string;
  meter: string;
  source: GrantSource;
  amount: number;
  remaining: number;
  expiresAt: string | null;
}
export interface Offer {
  id: string;
  label: string;
  detail: string;
}
export interface RewardRule {
  id: string;
  label: string;
  meter: string;
  amount: number;
  expiryDays: number | null;
}

// ---- Ledger and usage
export type LedgerEntry = StoredLedgerEntry;
export interface Hold {
  id: string;
  workspaceId: string;
  meter: string;
  amount: number;
  status: "open" | "settled";
  released: number;
}
export type UsageEvent = StoredUsageEvent;
export interface Table {
  id: string;
  workspaceId: string;
  name: string;
}
export interface Enrichment {
  id: string;
  label: string;
  rateItem: string;
  outcomes: string[];
}
export interface ModelChoice {
  workspaceId: string;
  enrichment: string;
  model: string;
  isDefault: boolean;
}

// ---- Growth
export interface Cohort {
  id: string;
  label: string;
  dimension: "rule" | "signupMonth" | "plan" | "region" | "source";
  size: number;
}
export interface Hypothesis {
  id: string;
  statement: string;
  metric: string;
}
export type Experiment = StoredExperiment;
export interface Variant {
  experimentId: string;
  name: string;
  exposed: number;
  converted: number;
}
export interface Scorecard {
  id: string;
  subject: string;
  rows: { metric: string; values: number[] }[];
}
export type Recommendation = Insight;
export interface Notification {
  id: string;
  workspaceId: string;
  channel: "email" | "in-app";
  text: string;
  at: string;
}

// ---- AI quality
export type SkillEndpoint = SimSkillEndpoint;
export type EvalSuite = SimEvalSuite;
export type EvalRun = SimEvalRun;

// ---- Operations
export interface ApprovalRequest extends Approval {
  status: "approved" | "rejected";
}
export interface AuditLog {
  id: string;
  at: string;
  actor: string;
  action: string;
  subject: string;
}
export type ChatTicket = SimChatTicket;

// ---------------------------------------------------------------- catalog

export type EntityHome = "Tenant Pack" | "Ledger" | "Event stream" | "Population" | "Derived" | "Store";

export interface EntityInfo {
  name: string;
  group: "Tenancy" | "Pricing" | "Ledger and usage" | "Growth" | "AI quality" | "Operations";
  home: EntityHome;
  fields: string[];
  count: number;
  example: string;
  /** Where to see it in the cockpit. */
  where: string;
}

export function domainCatalog(t: TenantState, sim: SimOutput | null): EntityInfo[] {
  const pack = t.pack;
  const hubIds = HUB_PERSONAS as readonly string[];
  const grants = hubIds.flatMap((id) => pack.meters.flatMap((m) => lotsOf(t.ledger, id, m.id)));
  const holds = holdsOf(t.ledger);
  const alerts = t.events.filter((e) => e.type === "alert.sent");
  const recs = workbenchInsights(t).length + hubIds.reduce((s, id) => s + hubInsights(t, id).length, 0);
  const audit = t.events.filter((e) => e.account === "tenant" || /^(approval|pack|ledger|consent|payment\.auth|promo|account|limit|plan|subscription)\./.test(e.type));
  const grantEntries = t.ledger.filter((x) => (x.kind === "grant" || x.kind === "rollover") && x.amount > 0);
  const ws = sim?.workspaces ?? [];
  const seats = ws.reduce((s, w) => s + w.seats, 0);
  const tables = ws.reduce((s, w) => s + w.tables, 0);
  const first = ws[0];
  const e = (x: Omit<EntityInfo, "example"> & { example?: string }): EntityInfo => ({ example: "", ...x });
  return [
    e({ name: "Tenant", group: "Tenancy", home: "Tenant Pack", fields: ["id", "company", "category", "billingModel", "regions"], count: 1, example: `${pack.company} · ${pack.category}`, where: "Brain → Tenant Pack" }),
    e({ name: "Workspace", group: "Tenancy", home: "Population", fields: ["id", "plan", "region", "source", "signupAt", "status"], count: ws.length + hubIds.length, example: first ? `${first.name} · ${first.planId} · ${first.region}` : "Maya's and Dev's accounts", where: "Brain → Population" }),
    e({ name: "User", group: "Tenancy", home: "Population", fields: ["id", "workspaceId", "name", "role"], count: seats + 4, example: "Maya, Dev (customers) · Nia, Sam (merchant)", where: "Persona switcher" }),
    e({ name: "Plan", group: "Pricing", home: "Tenant Pack", fields: ["id", "name", "price", "included", "caps", "features"], count: pack.plans.length, example: pack.plans.map((p) => p.name).join(", "), where: "Brain → Tenant Pack" }),
    e({ name: "Meter", group: "Pricing", home: "Tenant Pack", fields: ["id", "label", "unit", "pricePerUnit", "valueType"], count: pack.meters.length, example: pack.meters.map((m) => m.label).join(", "), where: "Brain → Tenant Pack" }),
    e({ name: "CreditGrant", group: "Ledger and usage", home: "Ledger", fields: ["source (plan · rollover · topup · reward · promo)", "amount", "remaining", "expiresAt"], count: grantEntries.length, example: grants.length ? `${grants.length} with credit left · next to spend: ${grants[0].source}` : "—", where: "Brain → Credit ledger → Lots" }),
    e({ name: "LedgerEntry", group: "Ledger and usage", home: "Ledger", fields: ["kind", "amount", "balance", "reason", "actor", "idempotencyKey", "hash"], count: t.ledger.length, example: t.ledger.length ? `${t.ledger[t.ledger.length - 1].kind} · ${t.ledger[t.ledger.length - 1].reason}` : "—", where: "Brain → Credit ledger" }),
    e({ name: "Hold", group: "Ledger and usage", home: "Ledger", fields: ["holdId", "meter", "amount", "status", "released"], count: holds.length, example: holds[0] ? `${holds[0].holdId} · ${holds[0].status}` : "—", where: "Brain → Clock" }),
    e({ name: "UsageEvent", group: "Ledger and usage", home: "Event stream", fields: ["type", "workflow", "step", "meters", "status", "reason"], count: t.events.length, example: t.events.length ? t.events[t.events.length - 1].type : "—", where: "Brain → Usage events" }),
    e({ name: "Table", group: "Ledger and usage", home: "Population", fields: ["id", "workspaceId", "name"], count: tables, example: `${pack.workUnit.many} a workspace enriches`, where: "Brain → Population" }),
    e({ name: "Enrichment", group: "Ledger and usage", home: "Tenant Pack", fields: ["id", "label", "rate-card step", "outcome mix", "models"], count: sim?.config.enrichments.length ?? 0, example: sim?.config.enrichments.map((x) => x.label).join(", ") ?? "—", where: "Brain → Population" }),
    e({ name: "ModelChoice", group: "Ledger and usage", home: "Population", fields: ["workspaceId", "enrichment", "model", "isDefault"], count: sim?.models.length ?? 0, example: sim ? `${Math.round(sim.totals.defaultModelShare * 100)}% of runs on the default model` : "—", where: "Brain → Population → Model choice" }),
    e({ name: "Cohort", group: "Growth", home: "Derived", fields: ["id", "label", "dimension", "size"], count: cohortDefs(pack).length + (sim ? Object.values(sim.cohorts).reduce((s, r) => s + r.length, 0) : 0), example: cohortDefs(pack)[0]?.label ?? "—", where: "Workbench → Cohorts · Brain → Population" }),
    e({ name: "Hypothesis", group: "Growth", home: "Store", fields: ["statement", "metric", "cohort"], count: t.experiments.length, example: t.experiments[0]?.hypothesis ?? "—", where: "Workbench → Experiments" }),
    e({ name: "Experiment", group: "Growth", home: "Store", fields: ["id", "status", "owner", "startedAt", "decision"], count: t.experiments.length, example: t.experiments[0]?.name ?? "—", where: "Workbench → Experiments" }),
    e({ name: "Variant", group: "Growth", home: "Store", fields: ["name", "exposed", "converted"], count: t.experiments.reduce((s, x) => s + x.arms.length, 0), example: t.experiments[0]?.arms.map((a) => a.name).join(" vs ") ?? "—", where: "Workbench → Experiments" }),
    e({ name: "Scorecard", group: "Growth", home: "Derived", fields: ["subject", "metric rows by day 1, 3, 7"], count: 1 + t.experiments.length, example: "Activation by day 1, 3 and 7", where: "Workbench → Overview" }),
    e({ name: "Offer", group: "Growth", home: "Tenant Pack", fields: ["id", "label", "detail"], count: pack.saves.length, example: pack.saves[0]?.label ?? "—", where: "Workbench → Churn" }),
    e({ name: "RewardRule", group: "Growth", home: "Tenant Pack", fields: ["id", "label", "meter", "amount", "expiryDays"], count: pack.rewards.length, example: pack.rewards[0]?.label ?? "—", where: "Credits Hub → Rewards" }),
    e({ name: "Recommendation", group: "Growth", home: "Derived", fields: ["surface", "tone", "title", "source"], count: recs, example: workbenchInsights(t)[0]?.title ?? "—", where: "Brain → Insights" }),
    e({ name: "SkillEndpoint", group: "AI quality", home: "Population", fields: ["id", "path", "rateItem", "models"], count: sim?.skills.length ?? 0, example: sim?.skills[0]?.path ?? "—", where: "Brain → Population → Evals" }),
    e({ name: "EvalSuite", group: "AI quality", home: "Population", fields: ["skillId", "cases", "metric"], count: sim?.suites.length ?? 0, example: sim?.suites[0]?.name ?? "—", where: "Brain → Population → Evals" }),
    e({ name: "EvalRun", group: "AI quality", home: "Population", fields: ["suiteId", "model", "passRate", "creditsPerCase", "vsDefault"], count: sim?.evalRuns.length ?? 0, example: sim?.evalRuns[0] ? `${sim.evalRuns[0].model} · ${Math.round(sim.evalRuns[0].passRate * 100)}%` : "—", where: "Brain → Population → Evals" }),
    e({ name: "Notification", group: "Operations", home: "Event stream", fields: ["workspaceId", "channel", "text", "at"], count: alerts.length, example: alerts[0]?.note ?? "Alerts at 50, 80 and 100%", where: "Credits Hub → Limits" }),
    e({ name: "ApprovalRequest", group: "Operations", home: "Store", fields: ["title", "actor", "risk", "decision", "auditId"], count: t.approvals.length, example: t.approvals[0]?.title ?? "None yet", where: "Brain → Approvals" }),
    e({ name: "AuditLog", group: "Operations", home: "Event stream", fields: ["at", "actor", "action", "subject"], count: audit.length, example: audit[audit.length - 1]?.type ?? "—", where: "Brain → Usage events" }),
    e({ name: "ChatTicket", group: "Operations", home: "Population", fields: ["workspaceId", "intent", "signals", "sentiment", "outcome", "messages"], count: sim?.chats.length ?? 0, example: sim?.chats[0] ? `${sim.chats[0].intent} · ${sim.chats[0].outcome}` : "—", where: "Brain → Help chats" }),
  ];
}
