// One governed tool layer (Phase 7 §7.1–7.3) for people, Chargebee's agents and external AI
// clients. Every call goes through `invoke`: token, tenant, kill switch, server scope, tier, rate
// limit, account scope, per-tool input constraints, idempotency, dry-run, then execute or route to
// approval. A write never executes without an approver: a person, or a standing budget a person
// approved (Auto within budget). Every call is logged with masked arguments.
import type { TenantState } from "@/core/types";
import { balanceOf } from "@/core/ledger";
import { meterTimeline } from "@/core/forecasting";
import { cheapestCover, estimateColumn, tablesOf, usdValue } from "@/core/table-run";
import { saveAutoTopUp, upsertLimit } from "@/core/hub-actions";
import { grantPromo } from "@/core/actions";
import { cycleOf, fnv1a } from "@/core/time";
import { fmtNum, fmtUsd } from "@/core/format";
import { planOf, primaryMeter } from "@/core/pack";
import { personaName } from "@/tenants/personas";
import { segmentById, segments } from "@/growth/population";
import { dailyHypotheses, hypothesisTitle, specFromHypothesis } from "@/growth/ideas";
import { approveExperiment, createExperiment, fundFromPool, launchExperiment, shipExperiment } from "@/growth/lab-actions";
import { guardReadings, scorecard, STATUS_LABEL } from "@/growth/lab";
import { dayOf, gid } from "@/growth/state";
import { searchKb } from "@/agents/cb/knowledge";
import { gateFor, latestRun, modelName, recommend, runResult } from "@/platform/evals";
import { draftSkill, startRun } from "@/platform/eval-actions";
import { composeMoment, summarise, validateMoment } from "@/platform/moments";
import { draftMoment, publishMoment } from "@/platform/portal-actions";
import { maskDeep, maskPII } from "@/platform/privacy";
import type { CallOutcome, FieldConstraint, McpActivity, McpApproval, McpState, Principal, Tier, ToolTier } from "@/platform/types";

export const TIER_RANK: Record<Tier, number> = { read: 0, draft: 1, approval: 2, auto: 3 };
export const TIER_LABEL: Record<Tier, string> = { read: "Read", draft: "Draft", approval: "Execute with approval", auto: "Auto within budget" };
export const TOOL_TIER_LABEL: Record<ToolTier, string> = { read: "Read", draft: "Draft", approval: "Approval" };

export const SERVERS: { id: string; label: string; existing: boolean; description: string }[] = [
  { id: "kb", label: "Knowledge Base", existing: true, description: "Help articles and policy documents" },
  { id: "data", label: "Data Lookup", existing: true, description: "Customers, subscriptions and invoices" },
  { id: "onboarding", label: "Onboarding", existing: true, description: "Merchant onboarding status and sources" },
  { id: "credits", label: "Credits", existing: false, description: "Balances, forecasts, run costs, top-ups and grants" },
  { id: "growth", label: "Growth", existing: false, description: "Cohorts, hypotheses and experiments" },
  { id: "evals", label: "Evals", existing: false, description: "Skills, eval runs and model recommendations" },
  { id: "offers", label: "Offers", existing: false, description: "Offers and breakage-funded grants" },
  { id: "portal", label: "Portal Experience", existing: false, description: "Portal config, previews and Moments" },
];

export interface FieldDef {
  name: string;
  type: "string" | "number" | "boolean" | "json";
  required?: boolean;
  description: string;
}

interface RunOut {
  t: TenantState;
  ok: boolean;
  summary: string;
  result: unknown;
}

export interface ToolDef {
  name: string;
  server: string;
  tier: ToolTier;
  description: string;
  fields: FieldDef[];
  /** What a write would spend; absent means it can never run under a standing budget. */
  budget?: (t: TenantState, args: Args) => { credits?: number; usd?: number; experiments?: number };
  run: (t: TenantState, args: Args, actor: string) => RunOut;
}

type Args = Record<string, unknown>;
const str = (v: unknown, d = "") => (typeof v === "string" ? v : v == null ? d : String(v));
const num = (v: unknown, d = 0) => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() && Number.isFinite(Number(v)) ? Number(v) : d);
const acct = (v: unknown): "maya" | "dev" | null => (v === "maya" || v === "dev" ? v : null);
const ok = (t: TenantState, summary: string, result: unknown): RunOut => ({ t, ok: true, summary, result });
const fail = (t: TenantState, summary: string): RunOut => ({ t, ok: false, summary, result: { error: summary } });
const ACCOUNT: FieldDef = { name: "account", type: "string", required: true, description: "Workspace: maya or dev" };

function needAccount(t: TenantState, a: Args): "maya" | "dev" | RunOut {
  const id = acct(a.account);
  return id ?? fail(t, `Unknown account "${str(a.account)}".`);
}

export const TOOLS: ToolDef[] = [
  // ---------------------------------------------------------------- existing servers
  { name: "search_kb", server: "kb", tier: "read", description: "Search help articles and policy documents", fields: [{ name: "query", type: "string", required: true, description: "Words to search for" }], run: (t, a) => { const xs = searchKb(str(a.query), 3); return ok(t, `${xs.length} articles`, xs.map((c) => ({ id: c.id, title: c.title, source: c.source }))); } },
  { name: "get_article", server: "kb", tier: "read", description: "Read one article", fields: [{ name: "id", type: "string", required: true, description: "Article id" }], run: (t, a) => { const c = searchKb(str(a.id), 1)[0]; return c ? ok(t, c.title, { id: c.id, title: c.title, body: c.body }) : fail(t, "Not found"); } },
  { name: "lookup_customer", server: "data", tier: "read", description: "Plan, region and status for a workspace", fields: [ACCOUNT], run: (t, a) => { const id = needAccount(t, a); if (typeof id !== "string") return id; const h = t.hub[id]; return ok(t, `${personaName(t.pack, id)} · ${planOf(t.pack, h.planId).name}`, { account: id, plan: planOf(t.pack, h.planId).name, region: h.region, status: h.status, seats: h.team.length }); } },
  { name: "lookup_subscription", server: "data", tier: "read", description: "Subscription, renewal and payment health", fields: [ACCOUNT], run: (t, a) => { const id = needAccount(t, a); if (typeof id !== "string") return id; const h = t.hub[id]; return ok(t, `${planOf(t.pack, h.planId).name} · payments ${h.dunning.status}`, { plan: h.planId, renews: cycleOf(t).end.toISOString().slice(0, 10), payment: h.dunning.status, card: `•••• ${h.card.last4}` }); } },
  { name: "lookup_invoice", server: "data", tier: "read", description: "Recent charges", fields: [ACCOUNT], run: (t, a) => { const id = needAccount(t, a); if (typeof id !== "string") return id; const xs = t.hub[id].charges.slice(-5); return ok(t, `${xs.length} charges`, xs.map((c) => ({ id: c.id, amount: c.amount, status: c.status, ts: c.ts, description: c.description }))); } },
  { name: "get_onboarding_status", server: "onboarding", tier: "read", description: "Where merchant onboarding stands", fields: [], run: (t) => { const o = t.growth.onboarding; const n = Object.values(o.sources).filter(Boolean).length; return ok(t, `${o.stage} · ${n} sources`, { stage: o.stage, sources: o.sources, firstExperiment: o.firstExperimentId }); } },
  { name: "connect_source", server: "onboarding", tier: "approval", description: "Connect a data source (needs the owner's consent)", fields: [{ name: "source", type: "string", required: true, description: "Source id" }], run: (t, a) => ok(t, `Connection request sent for ${str(a.source)}`, { source: str(a.source), status: "requested" }) },

  // ---------------------------------------------------------------- Credits
  {
    name: "get_balance", server: "credits", tier: "read", description: "Balances for a workspace", fields: [ACCOUNT],
    run: (t, a) => {
      const id = needAccount(t, a);
      if (typeof id !== "string") return id;
      const rows = t.pack.meters.map((m) => ({ meter: m.id, label: m.label, balance: Math.round(balanceOf(t.ledger, id, m.id) * 10) / 10 }));
      return ok(t, rows.map((r) => `${fmtNum(r.balance)} ${r.label}`).join(" · "), { account: id, balances: rows });
    },
  },
  {
    name: "get_burn_forecast", server: "credits", tier: "read", description: "When the primary meter runs out at the current pace", fields: [ACCOUNT, { name: "meter", type: "string", description: "Meter id (default: primary)" }],
    run: (t, a) => {
      const id = needAccount(t, a);
      if (typeof id !== "string") return id;
      const m = t.pack.meters.find((x) => x.id === str(a.meter)) ?? primaryMeter(t.pack);
      const tl = meterTimeline(t, id, m.id);
      const { day } = cycleOf(t);
      const left = tl.ranOutAt ? 0 : tl.runsOutDay != null ? Math.max(0, tl.runsOutDay - day) : null;
      return ok(t, left == null ? "Lasts the cycle" : `Runs out in about ${left} days`, { meter: m.id, perDay: Math.round(tl.rate * 10) / 10, daysLeft: left, confidence: tl.confidence });
    },
  },
  {
    name: "explain_run_cost", server: "credits", tier: "read", description: "Why the last run cost what it did", fields: [ACCOUNT],
    run: (t, a) => {
      const id = needAccount(t, a);
      if (typeof id !== "string") return id;
      const r = t.hub[id].runs[0];
      if (!r) return ok(t, "No runs yet", { runs: 0 });
      return ok(t, `${r.table}: ${fmtNum(r.done)} of ${fmtNum(r.rows)} rows`, { table: r.table, rows: r.rows, done: r.done, step: r.stepId, status: r.status });
    },
  },
  {
    name: "estimate_run_cost", server: "credits", tier: "read", description: "Estimate a table run before starting it", fields: [ACCOUNT, { name: "table", type: "string", description: "Table name (default: the workspace's main table)" }, { name: "rows", type: "number", description: "Rows to run" }],
    run: (t, a) => {
      const id = needAccount(t, a);
      if (typeof id !== "string") return id;
      const tables = tablesOf(t, id);
      const tb = tables.find((x) => x.name.toLowerCase() === str(a.table).toLowerCase()) ?? tables[0] ?? { id: "next-run", name: "Next run", rows: 1000, source: "", owner: id, columns: [], channel: "Table" };
      const rows = Math.max(1, Math.round(num(a.rows, tb.rows)));
      const member = t.hub[id].team[0]?.id ?? "owner";
      const steps = tb.columns.length ? tb.columns : [t.pack.rateCard[0].id];
      const need: Record<string, number> = {};
      for (const st of steps) for (const m of estimateColumn(t, id, member, tb, st, rows).meters) need[m.meter] = (need[m.meter] ?? 0) + m.expected;
      const have = Object.fromEntries(t.pack.meters.map((m) => [m.id, balanceOf(t.ledger, id, m.id)]));
      const fits = t.pack.meters.every((m) => (need[m.id] ?? 0) <= (have[m.id] ?? 0));
      const short = t.pack.meters.filter((m) => (need[m.id] ?? 0) > (have[m.id] ?? 0)).map((m) => `${fmtNum(Math.ceil((need[m.id] ?? 0) - (have[m.id] ?? 0)))} ${m.label}`);
      return ok(t, fits ? `Fits: needs ${t.pack.meters.map((m) => `${fmtNum(Math.round(need[m.id] ?? 0))} ${m.label}`).join(" + ")}` : `Short by ${short.join(" and ")}`, { table: tb.name, rows, columns: steps.length, need, have, fits, usd: usdValue(t.pack, need) });
    },
  },
  {
    name: "list_ledger_entries", server: "credits", tier: "read", description: "Recent ledger entries", fields: [ACCOUNT, { name: "limit", type: "number", description: "How many (max 20)" }],
    run: (t, a) => {
      const id = needAccount(t, a);
      if (typeof id !== "string") return id;
      const xs = t.ledger.filter((e) => e.account === id).slice(-Math.min(20, Math.max(1, num(a.limit, 5))));
      return ok(t, `${xs.length} entries`, xs.map((e) => ({ ts: e.ts, kind: e.kind, meter: e.meter, amount: e.amount, balance: e.balance, reason: e.reason })));
    },
  },
  {
    name: "create_topup_quote", server: "credits", tier: "draft", description: "Quote the cheapest top-up for an amount (nothing is charged)", fields: [ACCOUNT, { name: "meter", type: "string", description: "Meter id" }, { name: "units", type: "number", required: true, description: "Units wanted" }],
    run: (t, a) => {
      const m = t.pack.meters.find((x) => x.id === str(a.meter)) ?? primaryMeter(t.pack);
      const q = cheapestCover(t.pack, m.id, Math.max(1, num(a.units)));
      return q ? ok(t, `${fmtNum(q.units)} ${m.label} for ${fmtUsd(q.price)} (quote)`, { meter: m.id, ...q, charged: false }) : fail(t, "No top-up pack for that meter");
    },
  },
  {
    name: "set_auto_topup", server: "credits", tier: "approval", description: "Turn auto top-up on or off for a workspace", fields: [ACCOUNT, { name: "enabled", type: "boolean", required: true, description: "On or off" }, { name: "threshold", type: "number", description: "Top up below this balance" }, { name: "units", type: "number", description: "Units per top-up" }, { name: "monthlyCap", type: "number", description: "Monthly USD cap" }],
    run: (t, a, actor) => {
      const id = needAccount(t, a);
      if (typeof id !== "string") return id;
      const h = t.hub[id];
      const cfg = { ...h.autoTopUp, enabled: a.enabled === true || a.enabled === "true", threshold: num(a.threshold, h.autoTopUp.threshold), units: num(a.units, h.autoTopUp.units) };
      const r = saveAutoTopUp(t, id, cfg, num(a.monthlyCap, h.topUpCap), actor);
      return ok(r.state, `Auto top-up ${cfg.enabled ? "on" : "off"} for ${personaName(t.pack, id)}`, { enabled: cfg.enabled, threshold: cfg.threshold, units: cfg.units, monthlyCap: num(a.monthlyCap, h.topUpCap) });
    },
  },
  {
    name: "set_spend_limit", server: "credits", tier: "approval", description: "Set a workspace spend limit", fields: [ACCOUNT, { name: "amount", type: "number", required: true, description: "Limit in units of the primary meter" }],
    budget: () => ({}),
    run: (t, a, actor) => {
      const id = needAccount(t, a);
      if (typeof id !== "string") return id;
      const m = primaryMeter(t.pack);
      const r = upsertLimit(t, id, { id: "mcp-workspace", scope: "workspace", target: "workspace", meter: m.id, amount: Math.max(0, Math.round(num(a.amount))), behaviour: "block" }, actor, "Workspace");
      return ok(r.state, `Workspace limit ${fmtNum(num(a.amount))} ${m.label}`, { amount: num(a.amount) });
    },
  },
  {
    name: "grant_reward", server: "credits", tier: "approval", description: "Grant promotional credits to a workspace (capped)", fields: [ACCOUNT, { name: "amount", type: "number", required: true, description: "Credits to grant" }, { name: "expiryDays", type: "number", description: "Days until they expire" }, { name: "reason", type: "string", required: true, description: "Why" }],
    budget: (_t, a) => ({ credits: num(a.amount) }),
    run: (t, a, actor) => {
      const id = needAccount(t, a);
      if (typeof id !== "string") return id;
      const amount = Math.max(1, Math.round(num(a.amount)));
      const r = grantPromo(t, id, primaryMeter(t.pack).id, amount, maskPII(str(a.reason, "Reward")), actor, Math.max(1, Math.round(num(a.expiryDays, 30))));
      return ok(r.state, `Granted ${amount} ${primaryMeter(t.pack).label} to ${personaName(t.pack, id)}`, { amount, expiryDays: num(a.expiryDays, 30), entry: r.result.id });
    },
  },

  // ---------------------------------------------------------------- Growth
  { name: "list_cohorts", server: "growth", tier: "read", description: "Cohorts with size and lane", fields: [], run: (t) => { const xs = segments(t).filter((s) => s.lane !== "other"); return ok(t, `${xs.length} cohorts`, xs.map((s) => ({ id: s.id, label: s.label, size: s.size, lane: s.lane }))); } },
  { name: "get_cohort_behaviour", server: "growth", tier: "read", description: "Drivers for one cohort", fields: [{ name: "cohort", type: "string", required: true, description: "Cohort id" }], run: (t, a) => { const s = segmentById(t, str(a.cohort)); return s ? ok(t, `${s.label}: ${s.drivers[0]}`, { id: s.id, size: s.size, drivers: s.drivers }) : fail(t, "Unknown cohort"); } },
  { name: "generate_hypotheses", server: "growth", tier: "read", description: "Today's ranked hypotheses", fields: [], run: (t) => { const xs = dailyHypotheses(t, dayOf(t.clock)).slice(0, 3); return ok(t, `${xs.length} hypotheses; top: ${xs[0] ? hypothesisTitle(xs[0].id) : "none"}`, xs.map((h) => ({ id: h.id, title: hypothesisTitle(h.id), audience: h.audience.label, effect: h.effect }))); } },
  { name: "get_scorecard", server: "growth", tier: "read", description: "Scorecard for an experiment", fields: [{ name: "experiment", type: "string", required: true, description: "Experiment id" }], run: (t, a) => { const e = t.growth.lab.find((x) => x.id === str(a.experiment)); if (!e) return fail(t, "Unknown experiment"); const sc = scorecard(e); return ok(t, `${e.name}: ${STATUS_LABEL[e.status]}, ${sc.verdict}`, { id: e.id, status: e.status, verdict: sc.verdict, days: sc.daysRun, reason: sc.reason }); } },
  {
    name: "create_experiment_draft", server: "growth", tier: "draft", description: "Draft an experiment from a hypothesis (never launches)", fields: [{ name: "hypothesis", type: "string", description: "Hypothesis id (default: today's top)" }],
    run: (t, a, actor) => {
      const hs = dailyHypotheses(t, dayOf(t.clock));
      const h = hs.find((x) => x.id === str(a.hypothesis)) ?? hs[0];
      if (!h) return fail(t, "No hypothesis");
      if (t.growth.lab.some((e) => e.sourceId === h.id && e.status === "draft")) return ok(t, `Draft for "${hypothesisTitle(h.id)}" already exists`, { hypothesis: h.id, duplicate: true });
      const owner = actor.startsWith("agent:") ? `${actor.slice(6).charAt(0).toUpperCase()}${actor.slice(7)} agent` : "Nia";
      const r = createExperiment(t, specFromHypothesis(t, h, "hypothesis"), owner);
      return ok(r.t, `Drafted "${hypothesisTitle(h.id)}"`, { id: r.id, hypothesis: h.id, status: "draft" });
    },
  },
  {
    name: "launch_experiment", server: "growth", tier: "approval", description: "Approve and launch a drafted experiment", fields: [{ name: "experiment", type: "string", required: true, description: "Experiment id" }],
    budget: (t) => ({ experiments: t.growth.lab.filter((e) => e.status === "running" && !e.sandbox).length + 1 }),
    run: (t, a, actor) => {
      const id = str(a.experiment);
      const e = t.growth.lab.find((x) => x.id === id);
      if (!e) return fail(t, "Unknown experiment");
      let s = t;
      if (e.status === "draft") {
        const r = approveExperiment(s, id, actor);
        if (!r.ok) return fail(t, r.text);
        s = r.t;
      }
      const r = launchExperiment(s, id, actor, "nia");
      return r.ok ? ok(r.t, r.text, { id, status: "running" }) : fail(t, r.text);
    },
  },
  {
    name: "pause_experiment", server: "growth", tier: "approval", description: "Pause a running experiment", fields: [{ name: "experiment", type: "string", required: true, description: "Experiment id" }, { name: "reason", type: "string", required: true, description: "Why" }],
    budget: () => ({}),
    run: (t, a) => {
      const id = str(a.experiment);
      const e = t.growth.lab.find((x) => x.id === id);
      if (!e || e.status !== "running") return fail(t, "Not running");
      return ok({ ...t, growth: { ...t.growth, lab: t.growth.lab.map((x) => (x.id === id ? { ...x, status: "paused" as const, pausedReason: maskPII(str(a.reason, "Paused by an agent")) } : x)) } }, `Paused ${e.name}`, { id, status: "paused" });
    },
  },
  {
    name: "ship_variant", server: "growth", tier: "approval", description: "Ship the variant to 100%", fields: [{ name: "experiment", type: "string", required: true, description: "Experiment id" }],
    run: (t, a, actor) => {
      const r = shipExperiment(t, str(a.experiment), actor);
      return r.ok ? ok(r.t, r.text, { id: str(a.experiment), status: "shipped" }) : fail(t, r.text);
    },
  },

  // ---------------------------------------------------------------- Evals
  { name: "register_skill", server: "evals", tier: "draft", description: "Register a skill from a manifest (as a draft)", fields: [{ name: "manifest", type: "json", required: true, description: "Skill manifest" }], run: (t, a, actor) => { const r = draftSkill(t, a.manifest, actor); return r.ok ? ok(r.t, r.text, { id: r.id, status: "draft" }) : fail(t, r.text); } },
  {
    name: "run_eval", server: "evals", tier: "draft", description: "Run an eval in an isolated synthetic tenant", fields: [{ name: "skill", type: "string", required: true, description: "Skill id" }, { name: "repeats", type: "number", description: "1–5" }],
    run: (t, a, actor) => {
      const sk = str(a.skill);
      const last = latestRun(t.platform.evals, sk);
      const ds = last?.datasetId ?? t.platform.evals.datasets.find((d) => d.skillId === sk)?.id;
      if (!ds) return fail(t, "No dataset for that skill");
      const skill = t.platform.evals.skills.find((s) => s.id === sk);
      const r = startRun(t, { skillId: sk, datasetId: ds, models: skill?.manifest.allowedModels ?? [], repeats: num(a.repeats, 3), by: actor.replace(/^agent:/, "") || "Agent", trigger: "agent" });
      return r.ok ? ok(r.t, r.text, { run: r.id }) : fail(t, r.text);
    },
  },
  {
    name: "get_eval_result", server: "evals", tier: "read", description: "Latest eval scores for a skill", fields: [{ name: "skill", type: "string", required: true, description: "Skill id" }],
    run: (t, a) => {
      const run = latestRun(t.platform.evals, str(a.skill));
      if (!run) return fail(t, "No eval yet");
      const res = runResult(t.platform.evals, run, t.pack);
      return ok(t, res.models.map((m) => `${modelName(m.model)} ${m.quality.mean.toFixed(1)}`).join(" · "), res.models.map((m) => ({ model: m.model, quality: Math.round(m.quality.mean * 10) / 10, lo: Math.round(m.quality.lo * 10) / 10, hi: Math.round(m.quality.hi * 10) / 10, costShare: m.costShare, gate: gateFor(t.platform.evals, t.pack, run.skillId, m.model).state })));
    },
  },
  { name: "recommend_model", server: "evals", tier: "read", description: "Cheapest model within the non-inferiority margin", fields: [{ name: "skill", type: "string", required: true, description: "Skill id" }], run: (t, a) => { const r = recommend(t.platform.evals, t.pack, str(a.skill)); return ok(t, r.switch ? `Switch to ${modelName(r.model)}` : `Keep ${modelName(r.current)}`, { model: r.model, switch: r.switch, text: r.text }); } },

  // ---------------------------------------------------------------- Offers
  { name: "list_offers", server: "offers", tier: "read", description: "Drafted and live offers", fields: [], run: (t) => ok(t, `${t.growth.offers.length} offers`, t.growth.offers.slice(0, 10).map((o) => ({ id: o.id, offer: o.offer, audience: o.audienceLabel, status: o.status }))) },
  {
    name: "create_offer_draft", server: "offers", tier: "draft", description: "Draft an offer for a cohort (not live)", fields: [{ name: "cohort", type: "string", required: true, description: "Cohort id" }, { name: "pctOff", type: "number", required: true, description: "Percent off" }, { name: "months", type: "number", description: "Months" }],
    run: (t, a) => {
      const s = segmentById(t, str(a.cohort));
      if (!s) return fail(t, "Unknown cohort");
      const pct = Math.max(1, Math.min(50, Math.round(num(a.pctOff, 20))));
      const months = Math.max(1, Math.round(num(a.months, 1)));
      const o = { id: gid("offer", t.clock), ts: t.clock, audience: s.id, audienceLabel: s.label, size: s.size, offer: `${pct}% off for ${months} month${months === 1 ? "" : "s"}`, pctOff: pct, months, expiresDays: 14, status: "draft" as const, thread: null };
      return ok({ ...t, growth: { ...t.growth, offers: [o, ...t.growth.offers] } }, `Drafted ${o.offer} for ${s.label}`, { id: o.id, status: "draft" });
    },
  },
  {
    name: "grant_from_breakage", server: "offers", tier: "approval", description: "Fund promotional credits from the breakage pool (enforces the funding rule)", fields: [{ name: "label", type: "string", required: true, description: "What it is for" }, { name: "accounts", type: "number", required: true, description: "Accounts" }, { name: "creditsEach", type: "number", required: true, description: "Credits per account" }],
    budget: (_t, a) => ({ credits: num(a.accounts) * num(a.creditsEach) }),
    run: (t, a, actor) => {
      const r = fundFromPool(t, "reward", maskPII(str(a.label, "Agent grant")), Math.max(1, Math.round(num(a.accounts))), Math.max(1, Math.round(num(a.creditsEach))), actor);
      return r.ok ? ok(r.t, r.text, { funded: true }) : fail(t, r.text);
    },
  },

  // ---------------------------------------------------------------- Portal Experience
  { name: "get_portal_config", server: "portal", tier: "read", description: "Moments and embed configuration", fields: [], run: (t) => ok(t, `${t.platform.portal.moments.length} custom moments · embed ${t.platform.embed.mode}`, { moments: t.platform.portal.moments.map((m) => ({ id: m.id, live: m.live, versions: m.versions.length })), embed: { modules: t.platform.embed.modules, mode: t.platform.embed.mode } }) },
  {
    name: "preview_portal_variant", server: "portal", tier: "draft", description: "Compose and validate a Moment from plain words (preview only)", fields: [{ name: "prompt", type: "string", required: true, description: "The experience in plain words" }],
    run: (t, a) => {
      const c = composeMoment(t.pack, str(a.prompt));
      if (!c.def) return fail(t, c.errors[0] ?? "Could not compose");
      const issues = validateMoment(c.def, t.pack);
      return issues.length ? fail(t, issues[0]) : ok(t, summarise(t.pack, c.def), { definition: c.def, notes: c.notes });
    },
  },
  {
    name: "create_moment", server: "portal", tier: "approval", description: "Create a Moment from plain words", fields: [{ name: "prompt", type: "string", required: true, description: "The experience in plain words" }],
    run: (t, a, actor) => {
      const r = draftMoment(t, str(a.prompt), actor);
      return r.ok ? ok(r.t, r.text, { id: r.id }) : fail(t, r.text);
    },
  },
  {
    name: "publish_portal_variant", server: "portal", tier: "approval", description: "Publish a Moment version", fields: [{ name: "moment", type: "string", required: true, description: "Moment id" }, { name: "version", type: "number", description: "Version (default: latest)" }],
    run: (t, a, actor) => {
      const r = publishMoment(t, str(a.moment), a.version == null ? null : num(a.version), actor);
      return r.ok ? ok(r.t, r.text, { id: r.id, live: true }) : fail(t, r.text);
    },
  },
];

export const toolByName = (name: string) => TOOLS.find((x) => x.name === name) ?? null;

/** MCP resources and prompts exposed alongside the tools. */
export function resources(t: TenantState): { uri: string; label: string }[] {
  return [
    ...(["maya", "dev"] as const).map((a) => ({ uri: `ledger://${t.packId}/${a}/snapshot`, label: `Ledger snapshot · ${personaName(t.pack, a)}` })),
    ...t.pack.regions.map((r) => ({ uri: `policy://${t.packId}/regions/${r.id}`, label: `Regional policy · ${r.name}` })),
    { uri: `policy://${t.packId}/breakage-funding`, label: "Breakage funding rule" },
    ...t.growth.memory.filter((m) => !m.forgotten).slice(0, 6).map((m) => ({ uri: `memory://${t.packId}/cards/${m.id}`, label: `Memory card · ${m.title}` })),
  ];
}

// ------------------------------------------------------------------ the gateway

export interface CallRequest {
  principal: string;
  tool: string;
  args: Args;
  prompt?: string;
  dryRun?: boolean;
  idempotencyKey?: string | null;
  /** Wall-clock time in ms (rate limits); defaults to now. */
  wall?: number;
}

export interface CallResult {
  t: TenantState;
  activity: McpActivity;
}

const setMcp = (t: TenantState, fn: (m: McpState) => McpState): TenantState => ({ ...t, platform: { ...t.platform, mcp: fn(t.platform.mcp) } });

function record(t: TenantState, a: Omit<McpActivity, "id">): CallResult {
  const activity: McpActivity = { ...a, id: gid("call", t.clock), args: maskDeep(a.args), prompt: maskPII(a.prompt), summary: maskPII(a.summary), result: maskDeep(a.result) };
  return { t: setMcp(t, (m) => ({ ...m, activity: [activity, ...m.activity].slice(0, 400) })), activity };
}

/** Apply per-tool constraints: hidden fields are refused, defaults filled, min and max enforced. */
export function applyConstraints(tool: string, args: Args, c: Record<string, FieldConstraint> | undefined): { args: Args; error: string | null } {
  const out: Args = { ...args };
  for (const [field, rule] of Object.entries(c ?? {})) {
    if (rule.hidden && out[field] !== undefined) return { args, error: `"${field}" is disabled for ${tool}. Remove it from the call.` };
    if (rule.default !== undefined && (out[field] === undefined || out[field] === "")) out[field] = rule.default;
    const v = out[field];
    if (v !== undefined && (rule.min !== undefined || rule.max !== undefined)) {
      const n = num(v, NaN);
      if (!Number.isFinite(n)) return { args, error: `"${field}" must be a number.` };
      if (rule.min !== undefined && n < rule.min) return { args, error: `"${field}" is ${n}; the minimum for ${tool} is ${rule.min}.` };
      if (rule.max !== undefined && n > rule.max) return { args, error: `"${field}" is ${n}; the maximum for ${tool} is ${rule.max}.` };
    }
  }
  return { args: out, error: null };
}

export function withinBudget(t: TenantState, tool: ToolDef, args: Args): { ok: boolean; why: string } {
  if (!tool.budget) return { ok: false, why: `${tool.name} always needs a person to approve it.` };
  const b = tool.budget(t, args);
  const m = t.platform.mcp;
  const day = dayOf(t.clock);
  const spent = m.spent.day === day ? m.spent : { day, credits: 0, usd: 0 };
  if (b.credits && spent.credits + b.credits > m.budgets.creditsPerDay) return { ok: false, why: `Over the daily credit budget (${fmtNum(spent.credits)} of ${fmtNum(m.budgets.creditsPerDay)} used).` };
  if (b.usd && spent.usd + b.usd > m.budgets.spendPerDay) return { ok: false, why: `Over the daily spend budget (${fmtUsd(spent.usd, 0)} of ${fmtUsd(m.budgets.spendPerDay, 0)}).` };
  if (b.experiments && b.experiments > m.budgets.concurrentExperiments) return { ok: false, why: `Over the concurrent experiment budget (${m.budgets.concurrentExperiments}).` };
  return { ok: true, why: "" };
}

function base(p: Principal | null, tool: ToolDef | null, req: CallRequest, wall: number) {
  return {
    ts: "",
    wall,
    principal: req.principal,
    principalLabel: p?.label ?? req.principal,
    tool: req.tool,
    server: tool?.server ?? "?",
    tier: tool?.tier ?? ("read" as ToolTier),
    args: req.args,
    prompt: req.prompt ?? "",
    approver: null as string | null,
    approvalId: null as string | null,
    idempotencyKey: req.idempotencyKey ?? null,
    dryRun: !!req.dryRun,
    ms: 0,
    result: null as unknown,
  };
}

/** Every tool call from a person, agent or external client goes through here. */
export function invoke(t0: TenantState, req: CallRequest): CallResult {
  const t = t0;
  const wall = req.wall ?? Date.now();
  const m = t.platform.mcp;
  const p = m.principals.find((x) => x.id === req.principal) ?? null;
  const tool = toolByName(req.tool);
  const b = { ...base(p, tool, req, wall), ts: t.clock };
  const deny = (reason: string) => record(t, { ...b, outcome: "denied", reason, summary: reason });
  if (!p || p.revoked) return deny("Unknown or revoked token.");
  if (p.tenant !== t.packId) return deny(`This token belongs to tenant "${p.tenant}" and cannot read or write "${t.packId}".`);
  if (!tool) return deny(`No tool called ${req.tool}.`);
  if (m.killSwitch && p.kind !== "human") return deny("The global kill switch is on: agents and external clients are halted.");
  const agentId = p.id.startsWith("agent:") ? p.id.slice(6) : null;
  if (agentId && t.platform.agents.paused[agentId]) return deny("This agent's kill switch is on.");
  if (!p.servers.includes(tool.server)) return deny(`Token scope does not include the ${SERVERS.find((s) => s.id === tool.server)?.label ?? tool.server} server.`);
  const need = tool.tier === "read" ? 0 : tool.tier === "draft" ? 1 : req.dryRun ? 1 : 2;
  if (TIER_RANK[p.tier] < need) return deny(`${TIER_LABEL[p.tier]} tokens cannot call ${tool.name} (${TOOL_TIER_LABEL[tool.tier]} tier).`);
  const recent = m.activity.filter((a) => a.principal === p.id && wall - a.wall < 60_000).length;
  if (recent >= p.rateLimitPerMin) return deny(`Rate limit: ${p.rateLimitPerMin} calls a minute for this token.`);
  let args: Args = { ...req.args };
  if (p.account) {
    if (tool.fields.some((f) => f.name === "account")) {
      if (args.account !== undefined && args.account !== p.account) return deny(`This token is scoped to ${personaName(t.pack, p.account)}'s workspace and cannot see another account.`);
      args.account = p.account;
    }
  }
  const c = applyConstraints(tool.name, args, m.constraints[tool.name]);
  if (c.error) return deny(c.error);
  args = c.args;
  const missing = tool.fields.find((f) => f.required && (args[f.name] === undefined || args[f.name] === ""));
  if (missing) return deny(`Missing "${missing.name}".`);
  const key = req.idempotencyKey ?? null;
  if (key) {
    const prior = m.activity.find((a) => a.principal === p.id && a.tool === tool.name && a.idempotencyKey === key && a.outcome !== "denied" && a.outcome !== "replayed");
    if (prior) return record(t, { ...b, args, outcome: "replayed", reason: `Same idempotency key as ${prior.id}: returned the first result, nothing ran twice.`, summary: prior.summary, result: prior.result, approvalId: prior.approvalId, approver: prior.approver });
  }
  const started = typeof performance !== "undefined" ? performance.now() : 0;
  const ms = () => Math.max(1, Math.round((typeof performance !== "undefined" ? performance.now() : 0) - started));
  const actor = p.kind === "human" ? `merchant:${p.label.split(" ")[0].toLowerCase()}` : p.id;
  if (tool.tier === "read" || tool.tier === "draft") {
    const r = tool.run(t, args, actor);
    if (!r.ok) return record(t, { ...b, args, outcome: "denied", reason: r.summary, summary: r.summary, result: r.result, ms: ms() });
    const outcome: CallOutcome = tool.tier === "read" ? "ok" : "draft";
    return record(r.t, { ...b, args, outcome, reason: tool.tier === "draft" ? "Drafts never change anything live." : "", summary: r.summary, result: r.result, ms: ms() });
  }
  // Writes.
  if (req.dryRun) {
    const r = tool.run(t, args, actor);
    return record(t, { ...b, args, outcome: "dry-run", reason: "Dry run: nothing was written.", summary: r.ok ? `Would: ${r.summary}` : `Would fail: ${r.summary}`, result: r.result, ms: ms() });
  }
  if (p.tier === "auto") {
    const bud = withinBudget(t, tool, args);
    if (bud.ok) {
      const r = tool.run(t, args, actor);
      if (!r.ok) return record(t, { ...b, args, outcome: "denied", reason: r.summary, summary: r.summary, result: r.result, ms: ms() });
      const spend = tool.budget!(t, args);
      const day = dayOf(t.clock);
      const s = setMcp(r.t, (x) => {
        const sp = x.spent.day === day ? x.spent : { day, credits: 0, usd: 0 };
        return { ...x, spent: { day, credits: sp.credits + (spend.credits ?? 0), usd: sp.usd + (spend.usd ?? 0) } };
      });
      return record(s, { ...b, args, outcome: "executed", reason: "Inside the standing budget.", approver: `Standing budget approved by ${m.budgets.approvedBy}`, summary: r.summary, result: r.result, ms: ms() });
    }
    return queue(t, p, tool, args, req, b, bud.why);
  }
  return queue(t, p, tool, args, req, b, "Writes need a person to approve them.");
}

function queue(t: TenantState, p: Principal, tool: ToolDef, args: Args, req: CallRequest, b: ReturnType<typeof base> & { ts: string }, why: string): CallResult {
  const approvalId = gid("apv", t.clock);
  const rec = record(t, { ...b, args, outcome: "pending", reason: `Routed to approval. ${why}`, summary: `Waiting for approval: ${tool.name}`, approvalId });
  const ap: McpApproval = { id: approvalId, ts: t.clock, tool: tool.name, args: maskDeep(args), principal: p.id, principalLabel: p.label, prompt: maskPII(req.prompt ?? ""), status: "pending", decidedBy: null, decidedAt: null, activityId: rec.activity.id, idempotencyKey: req.idempotencyKey ?? null };
  // Keep the unmasked arguments only for execution; the stored copy is masked.
  const store = { ...ap, args };
  return { t: setMcp(rec.t, (m) => ({ ...m, approvals: [store, ...m.approvals].slice(0, 100) })), activity: rec.activity };
}

/** A person approves or rejects a queued write. Approval runs it once and records the approver. */
export function decideApproval(t: TenantState, id: string, approve: boolean, by: string): CallResult | null {
  const ap = t.platform.mcp.approvals.find((a) => a.id === id);
  if (!ap || ap.status !== "pending") return null;
  const tool = toolByName(ap.tool);
  const p = t.platform.mcp.principals.find((x) => x.id === ap.principal) ?? null;
  const mark = (s: TenantState, status: McpApproval["status"]) => setMcp(s, (m) => ({ ...m, approvals: m.approvals.map((a) => (a.id === id ? { ...a, status, decidedBy: by, decidedAt: t.clock } : a)) }));
  const b = { ...base(p, tool, { principal: ap.principal, tool: ap.tool, args: ap.args, prompt: ap.prompt, idempotencyKey: ap.idempotencyKey }, Date.now()), ts: t.clock, approvalId: id };
  if (!approve || !tool) return record(mark(t, "rejected"), { ...b, outcome: "denied", reason: `Rejected by ${by}.`, summary: `Rejected: ${ap.tool}`, approver: by });
  if (t.platform.mcp.killSwitch && p?.kind !== "human") return record(t, { ...b, outcome: "denied", reason: "The kill switch is on. Turn it off before approving agent writes.", summary: "Halted by the kill switch" });
  const r = tool.run(t, ap.args, p?.kind === "human" ? `merchant:${by.toLowerCase()}` : ap.principal);
  if (!r.ok) return record(mark(t, "rejected"), { ...b, outcome: "denied", reason: r.summary, summary: r.summary, approver: by });
  return record(mark(r.t, "approved"), { ...b, outcome: "executed", reason: "Approved.", summary: r.summary, result: r.result, approver: by });
}

/** A scoped token: shown once, stored as a fingerprint. */
export function createPrincipal(t: TenantState, i: { label: string; kind: Principal["kind"]; role: Principal["role"]; servers: string[]; account: Principal["account"]; rateLimitPerMin: number }): { t: TenantState; token: string; principal: Principal } {
  const tier: Tier = i.role === "viewer" ? "read" : i.role === "analyst" ? "draft" : i.role === "operator" ? "approval" : "auto";
  const raw = `cbmcp_${t.packId}_${fnv1a(`${i.label}|${t.clock}|${Math.random()}`)}${fnv1a(`${Math.random()}`)}`;
  const principal: Principal = { id: `ext:${fnv1a(raw).slice(0, 8)}`, label: i.label, kind: i.kind, role: i.role, tier, tenant: t.packId, servers: i.servers, account: i.account, rateLimitPerMin: i.rateLimitPerMin, fingerprint: fnv1a(raw).slice(0, 8), createdAt: t.clock, revoked: false };
  return { t: setMcp(t, (m) => ({ ...m, principals: [...m.principals, principal] })), token: raw, principal };
}

export function revokePrincipal(t: TenantState, id: string): TenantState {
  return setMcp(t, (m) => ({ ...m, principals: m.principals.map((p) => (p.id === id ? { ...p, revoked: true } : p)) }));
}

export function setConstraint(t: TenantState, tool: string, field: string, rule: FieldConstraint | null): TenantState {
  return setMcp(t, (m) => {
    const cur = { ...(m.constraints[tool] ?? {}) };
    if (rule) cur[field] = rule;
    else delete cur[field];
    return { ...m, constraints: { ...m.constraints, [tool]: cur } };
  });
}

export function setKillSwitch(t: TenantState, on: boolean): TenantState {
  return setMcp(t, (m) => ({ ...m, killSwitch: on }));
}

export function setBudgets(t: TenantState, b: Partial<McpState["budgets"]>): TenantState {
  return setMcp(t, (m) => ({ ...m, budgets: { ...m.budgets, ...b } }));
}

/** Plain-language explanation of a logged call ("Explain this action"). */
export function explainActivity(t: TenantState, a: McpActivity): string {
  const tool = toolByName(a.tool);
  const what = tool ? `${a.principalLabel} called ${a.tool} on the ${SERVERS.find((s) => s.id === tool.server)?.label ?? tool.server} server (${TOOL_TIER_LABEL[tool.tier]} tier)` : `${a.principalLabel} called ${a.tool}`;
  const args = Object.keys(a.args).length ? ` with ${Object.entries(a.args).map(([k, v]) => `${k} = ${typeof v === "object" ? "…" : String(v)}`).join(", ")}` : "";
  const out: Record<CallOutcome, string> = {
    ok: "It only read data, so it ran straight away.",
    draft: "It created a draft. Nothing live changed.",
    pending: "It is a write, so it waits in Pending approvals. Nothing has changed yet.",
    executed: a.approver?.startsWith("Standing budget") ? `It ran without a new click because it fits the standing budget (${a.approver.replace("Standing budget approved by ", "approved by ")}).` : `It ran after ${a.approver ?? "a person"} approved it.`,
    denied: `It was refused: ${a.reason}`,
    "dry-run": "It was a dry run: you see what would happen; nothing was written.",
    replayed: "It reused an idempotency key, so the first result came back and nothing ran twice.",
  };
  return `${what}${args}. ${out[a.outcome]}${a.prompt ? ` The request was: "${a.prompt}".` : ""}`;
}

export const tierAllows = (tier: Tier, toolTier: ToolTier) => TIER_RANK[tier] >= (toolTier === "read" ? 0 : toolTier === "draft" ? 1 : 2);
export const isWrite = (tool: string) => toolByName(tool)?.tier === "approval";
export const guardBreached = (t: TenantState, id: string) => {
  const e = t.growth.lab.find((x) => x.id === id);
  return e ? guardReadings(e).some((g) => g.breached) : false;
};
