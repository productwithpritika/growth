// Release rail, feature flags, portfolio and the product's own metric tree (Phase 8 §8.2–8.4).
// Every module is a feature key with a maturity (Crawl, Walk, Run, tied to the Horizon toggle)
// and a flag (percentage rollout and a kill switch). Killing a module hides it everywhere and
// marks what depends on it as blocked on the portfolio.
import type { TenantState } from "@/core/types";
import { FEATURE_HORIZON, type FeatureKey } from "@/platform/features";
import { addDays } from "@/core/time";
import { growthSim, isPaid, lastDay, scaleOf } from "@/growth/population";
import { todaySnapshot } from "@/growth/analytics";
import { ttfe } from "@/growth/tour";
import type { FlagState, PlatformState, Release } from "@/platform/types";

export type Layer = "ledger" | "insights" | "experiments" | "evals" | "autonomy";

export const LAYERS: { id: Layer; label: string; why: string }[] = [
  { id: "ledger", label: "Ledger and usage events", why: "Every number downstream is computed from the ledger and metered events, so it ships first." },
  { id: "insights", label: "Insights", why: "Forecasts, cohorts and designed moments turn the ledger into decisions." },
  { id: "experiments", label: "Experiments", why: "Changes ship as tests with holdouts and guardrails before they ship to everyone." },
  { id: "evals", label: "Evals", why: "AI changes need a quality gate before they can be tested on customers." },
  { id: "autonomy", label: "Autonomy", why: "Agents act only on top of evals, approvals and budgets, so they ship last." },
];

export interface ModuleMeta {
  key: FeatureKey;
  label: string;
  layer: Layer;
  impact: number;
  effort: number;
  deps: FeatureKey[];
}

export const MODULES: ModuleMeta[] = [
  { key: "hub.home", label: "Credits Hub home", layer: "ledger", impact: 7, effort: 3, deps: [] },
  { key: "hub.usage", label: "Usage explainer", layer: "ledger", impact: 6, effort: 3, deps: ["hub.home"] },
  { key: "hub.topups", label: "Top-ups", layer: "ledger", impact: 9, effort: 3, deps: ["hub.home"] },
  { key: "hub.billing", label: "Billing and payments", layer: "ledger", impact: 7, effort: 4, deps: ["hub.home"] },
  { key: "hub.tables", label: "Table runs and estimator", layer: "ledger", impact: 8, effort: 5, deps: ["hub.usage"] },
  { key: "hub.limits", label: "Limits and requests", layer: "ledger", impact: 6, effort: 3, deps: ["hub.home"] },
  { key: "wb.economics", label: "Unit economics", layer: "ledger", impact: 7, effort: 3, deps: [] },
  { key: "wb.onboard", label: "Onboard a tenant", layer: "ledger", impact: 6, effort: 5, deps: [] },
  { key: "wb.packs", label: "Pack Builder", layer: "ledger", impact: 7, effort: 5, deps: ["wb.onboard"] },
  { key: "wb.embed", label: "Embed SDK", layer: "ledger", impact: 8, effort: 6, deps: ["hub.home", "hub.topups"] },
  { key: "hub.forecast", label: "Run-out forecast", layer: "insights", impact: 8, effort: 4, deps: ["hub.usage"] },
  { key: "hub.moments", label: "Designed moments", layer: "insights", impact: 9, effort: 5, deps: ["hub.forecast"] },
  { key: "hub.plan", label: "Plan fit", layer: "insights", impact: 8, effort: 5, deps: ["hub.usage"] },
  { key: "hub.lifecycle", label: "Lifecycle lens", layer: "insights", impact: 6, effort: 4, deps: ["hub.home"] },
  { key: "wb.today", label: "Today", layer: "insights", impact: 7, effort: 3, deps: [] },
  { key: "wb.overview", label: "Cohorts", layer: "insights", impact: 7, effort: 4, deps: [] },
  { key: "wb.breakage", label: "Breakage pool", layer: "insights", impact: 7, effort: 4, deps: ["wb.economics"] },
  { key: "hub.rewards", label: "Rewards and Daily Spark", layer: "experiments", impact: 6, effort: 4, deps: ["wb.breakage"] },
  { key: "wb.hypotheses", label: "Hypotheses", layer: "experiments", impact: 7, effort: 5, deps: ["wb.overview"] },
  { key: "wb.experiments", label: "Experiment lab", layer: "experiments", impact: 9, effort: 7, deps: ["wb.overview"] },
  { key: "wb.plays", label: "Experiment plays", layer: "experiments", impact: 6, effort: 3, deps: ["wb.experiments"] },
  { key: "wb.churn", label: "Churn arrest", layer: "experiments", impact: 7, effort: 5, deps: ["wb.overview"] },
  { key: "wb.optimiser", label: "Plan optimiser", layer: "experiments", impact: 6, effort: 6, deps: ["hub.plan"] },
  { key: "wb.rewards", label: "Rewards studio", layer: "experiments", impact: 5, effort: 4, deps: ["wb.breakage"] },
  { key: "wb.evals", label: "Bring Your Own Evals", layer: "evals", impact: 9, effort: 8, deps: ["wb.experiments"] },
  { key: "hub.cheaperModel", label: "Cheaper-model suggestion", layer: "evals", impact: 7, effort: 4, deps: ["wb.evals"] },
  { key: "wb.ask", label: "Ask CB", layer: "autonomy", impact: 8, effort: 6, deps: ["wb.today"] },
  { key: "hub.assistant", label: "Credits assistant", layer: "autonomy", impact: 6, effort: 6, deps: ["wb.ask"] },
  { key: "wb.start", label: "Agentic onboarding and tour", layer: "autonomy", impact: 8, effort: 8, deps: ["wb.overview", "wb.experiments"] },
  { key: "wb.mcp", label: "MCP Console", layer: "autonomy", impact: 8, effort: 6, deps: ["hub.topups"] },
  { key: "wb.controls", label: "MCP usage and caps", layer: "autonomy", impact: 5, effort: 3, deps: ["wb.mcp"] },
  { key: "wb.agents", label: "Agents", layer: "autonomy", impact: 8, effort: 7, deps: ["wb.mcp", "wb.evals"] },
  { key: "wb.experiences", label: "Portal experiences", layer: "autonomy", impact: 7, effort: 6, deps: ["hub.moments", "wb.mcp"] },
];

export const moduleOf = (key: string) => MODULES.find((m) => m.key === key) ?? null;

const PARTIAL: Partial<Record<FeatureKey, number>> = { "wb.evals": 50, "wb.mcp": 25, "wb.agents": 25, "wb.experiences": 10, "wb.embed": 10, "hub.assistant": 50 };

export function initFlags(): Record<string, FlagState> {
  return Object.fromEntries(MODULES.map((m) => [m.key, { rollout: PARTIAL[m.key] ?? 100, killed: false }]));
}

export const flagOf = (p: Pick<PlatformState, "flags"> | undefined, key: string): FlagState => p?.flags[key] ?? { rollout: 100, killed: false };
export const isKilled = (p: Pick<PlatformState, "flags"> | undefined, key: string) => !!p?.flags[key]?.killed;

export function setFlag(t: TenantState, key: string, patch: Partial<FlagState>): TenantState {
  const cur = flagOf(t.platform, key);
  return { ...t, platform: { ...t.platform, flags: { ...t.platform.flags, [key]: { rollout: Math.max(0, Math.min(100, Math.round(patch.rollout ?? cur.rollout))), killed: patch.killed ?? cur.killed } } } };
}

// ------------------------------------------------------------------ release rail

export const TEMPLATES: { tier: 1 | 2 | 3; label: string; cadence: string; examples: string[]; gates: { id: string; label: string }[]; rule: string }[] = [
  { tier: 3, label: "Tier 3 · daily", cadence: "Every day", examples: ["Copy and rule tweaks", "New slash command", "Reward-rule tuning", "Scorecard refresh", "New Moment variant"], gates: [], rule: "Auto-approved inside guardrails; rolled out 10% → 50% → 100%." },
  { tier: 2, label: "Tier 2 · every two weeks", cadence: "Fortnightly", examples: ["New play", "Widget", "Eval suite", "Offer template", "Moment template", "Tenant Pack option"], gates: [{ id: "product", label: "Product sign-off" }, { id: "finance", label: "Finance sign-off" }], rule: "Needs product and finance sign-off before rollout." },
  { tier: 1, label: "Tier 1 · every three months", cadence: "Quarterly", examples: ["Agentic onboarding", "Bring Your Own Evals", "Pack marketplace", "Embed SDK v2"], gates: [{ id: "review", label: "Launch review" }, { id: "enablement", label: "Enablement kit" }, { id: "beta", label: "Customer beta" }], rule: "Needs a launch review, an enablement kit and a customer beta." },
];

export function seedReleases(clockIso: string): Release[] {
  const at = (d: number) => addDays(new Date(clockIso), d).toISOString();
  return [
    { id: "rel-cmd", tier: 3, title: "New /eval slash command", module: "wb.ask", status: "shipped", rollout: 100, signoffs: {}, at: at(-1) },
    { id: "rel-copy", tier: 3, title: "Run-out moment copy: show the day, not the date", module: "hub.moments", status: "rolling-out", rollout: 50, signoffs: {}, at: at(0) },
    { id: "rel-suite", tier: 2, title: "Contact-data accuracy eval suite", module: "wb.evals", status: "in-review", rollout: 0, signoffs: { product: true, finance: false }, at: at(3) },
    { id: "rel-seat", tier: 2, title: "Tenant Pack option: seats plus a credit pool", module: "wb.packs", status: "rolling-out", rollout: 25, signoffs: { product: true, finance: true }, at: at(-2) },
    { id: "rel-byoe", tier: 1, title: "Bring Your Own Evals", module: "wb.evals", status: "rolling-out", rollout: 50, signoffs: { review: true, enablement: true, beta: true }, at: at(-6) },
    { id: "rel-embed2", tier: 1, title: "Embed SDK v2", module: "wb.embed", status: "planned", rollout: 0, signoffs: { review: false, enablement: false, beta: false }, at: at(40) },
  ];
}

export function startRelease(t: TenantState, tier: 1 | 2 | 3, title: string, module: string): TenantState {
  const tpl = TEMPLATES.find((x) => x.tier === tier)!;
  const r: Release = { id: `rel-${Date.now().toString(36)}`, tier, title: title.trim() || tpl.examples[0], module, status: tier === 3 ? "rolling-out" : "in-review", rollout: tier === 3 ? 10 : 0, signoffs: Object.fromEntries(tpl.gates.map((g) => [g.id, false])), at: t.clock };
  return { ...t, platform: { ...t.platform, releases: [r, ...t.platform.releases] } };
}

export function signOff(t: TenantState, id: string, gate: string, on: boolean): TenantState {
  return { ...t, platform: { ...t.platform, releases: t.platform.releases.map((r) => (r.id === id ? { ...r, signoffs: { ...r.signoffs, [gate]: on } } : r)) } };
}

export const gatesDone = (r: Release) => Object.values(r.signoffs).every(Boolean);

/** Next rollout step: 10 → 50 → 100 (shipped). Blocked until every gate is signed. */
export function advanceRelease(t: TenantState, id: string): { t: TenantState; ok: boolean; text: string } {
  const r = t.platform.releases.find((x) => x.id === id);
  if (!r) return { t, ok: false, text: "Release not found." };
  if (!gatesDone(r)) return { t, ok: false, text: `Waiting for ${Object.entries(r.signoffs).filter(([, v]) => !v).map(([k]) => TEMPLATES.find((x) => x.tier === r.tier)?.gates.find((g) => g.id === k)?.label ?? k).join(", ")}.` };
  const next = r.rollout < 10 ? 10 : r.rollout < 50 ? 50 : 100;
  const upd: Release = { ...r, rollout: next, status: next === 100 ? "shipped" : "rolling-out" };
  return { t: { ...t, platform: { ...t.platform, releases: t.platform.releases.map((x) => (x.id === id ? upd : x)) } }, ok: true, text: next === 100 ? `${r.title} shipped to everyone.` : `${r.title} is at ${next}%.` };
}

// ------------------------------------------------------------------ portfolio

export type ModuleStatus = "live" | "rolling-out" | "killed" | "blocked";

export function moduleStatus(p: Pick<PlatformState, "flags">, key: FeatureKey, seen = new Set<string>()): ModuleStatus {
  const f = flagOf(p, key);
  if (f.killed) return "killed";
  if (seen.has(key)) return "live";
  seen.add(key);
  const m = moduleOf(key);
  if (m?.deps.some((d) => { const s = moduleStatus(p, d, seen); return s === "killed" || s === "blocked"; })) return "blocked";
  return f.rollout < 100 ? "rolling-out" : "live";
}

export function portfolio(p: Pick<PlatformState, "flags">) {
  const rows = MODULES.map((m) => ({ ...m, horizon: FEATURE_HORIZON[m.key], status: moduleStatus(p, m.key), rollout: flagOf(p, m.key).rollout }));
  const blocked = rows.filter((r) => r.status === "blocked");
  const killed = rows.filter((r) => r.status === "killed");
  const first = LAYERS.map((l) => ({ ...l, modules: rows.filter((r) => r.layer === l.id) }));
  const plan: string[] = [];
  plan.push(`First: ${first[0].label.toLowerCase()} and ${first[1].label.toLowerCase()} (${rows.filter((r) => r.horizon === "crawl").length} Crawl modules). ${first[0].why}`);
  plan.push(`Next: experiments, then evals (${rows.filter((r) => r.horizon === "walk").length} Walk modules). ${first[3].why}`);
  plan.push(`Later: autonomy (${rows.filter((r) => r.horizon === "run").length} Run modules). ${first[4].why}`);
  if (killed.length) plan.push(`Killed now: ${killed.map((k) => k.label).join(", ")}. ${blocked.length ? `That blocks ${blocked.map((b) => b.label).join(", ")} until it is back.` : "Nothing else depends on it."}`);
  return { rows, layers: first, plan };
}

// ------------------------------------------------------------------ observability

export const EVENT_TAXONOMY: { name: string; properties: string; owner: string }[] = [
  { name: "moment.shown", properties: "moment_id, version, account, plan, trigger_value, locale", owner: "Credits Hub" },
  { name: "moment.action_clicked", properties: "moment_id, version, action, account", owner: "Credits Hub" },
  { name: "moment.dismissed", properties: "moment_id, reason, account", owner: "Credits Hub" },
  { name: "topup.started", properties: "account, meter, units, price, surface (hosted|embedded)", owner: "Billing" },
  { name: "topup.completed", properties: "account, meter, units, price, auto", owner: "Billing" },
  { name: "auto_topup.enabled", properties: "account, threshold, units, monthly_cap, region", owner: "Billing" },
  { name: "plan.changed", properties: "account, from_plan, to_plan, proration, surface", owner: "Billing" },
  { name: "payment.failed", properties: "account, invoice_id, attempt, decline_code", owner: "Billing" },
  { name: "payment.recovered", properties: "account, invoice_id, days_to_recover, channel", owner: "Billing" },
  { name: "ledger.posted", properties: "account, meter, kind, amount, reason, actor, idempotency_key", owner: "Ledger" },
  { name: "experiment.launched", properties: "experiment_id, layer, audience_size, holdout, guardrails", owner: "Growth" },
  { name: "experiment.stopped", properties: "experiment_id, reason (stop-loss|canary|manual), day", owner: "Growth" },
  { name: "eval.run_completed", properties: "skill_id, models, examples, repeats, eval_credits, sandbox_tenant", owner: "Evals" },
  { name: "eval.gate_checked", properties: "skill_id, model, state, override_id", owner: "Evals" },
  { name: "mcp.tool_called", properties: "principal, tool, tier, outcome, approver, idempotency_key, dry_run", owner: "Platform" },
  { name: "agent.run", properties: "agent_id, trigger, calls, outcome", owner: "Platform" },
  { name: "onboarding.first_experiment", properties: "tenant, seconds_since_connect, launched_by", owner: "Growth" },
];

export interface Metric {
  id: string;
  label: string;
  value: number;
  display: string;
  trend: { x: string; y: number }[];
  good: "up" | "down";
  note: string;
}

const pct = (x: number, d = 0) => `${(x * 100).toFixed(d)}%`;

/** The north-star metric, its inputs and guardrails, computed from the simulation and the live state. */
export function productHealth(t: TenantState, nowMs = Date.now()): { north: Metric; inputs: Metric[]; guards: Metric[] } {
  const sim = growthSim(t);
  const k = scaleOf(t.pack);
  const D = lastDay(sim);
  const snap = todaySnapshot(t);
  const weeks = 8;
  const week = (i: number) => sim.daily.slice(Math.max(0, D - 7 * (weeks - i) + 1), D - 7 * (weeks - i - 1) + 1);
  const label = (i: number) => (week(i)[0]?.date ?? "").slice(5);
  const active = sim.workspaces.filter((w) => w.status === "active" || w.status === "idle");
  const activeN = Math.max(1, active.length * k);
  const series = (f: (rows: ReturnType<typeof week>, i: number) => number) => Array.from({ length: weeks }, (_, i) => ({ x: label(i), y: Math.round(f(week(i), i) * 1000) / 1000 }));
  // North star: value of conversions that started in a monetization moment, per active account, per week.
  const nsWeek = (rows: ReturnType<typeof week>) => (rows.reduce((s, r) => s + r.topUpRevenue * 0.62 + r.subsRevenue * 0.04, 0) * k) / activeN;
  const north: Metric = { id: "north", label: "Monetization-moment conversion value per active account", value: nsWeek(week(weeks - 1)), display: `$${nsWeek(week(weeks - 1)).toFixed(2)} a week`, trend: series((r) => nsWeek(r)), good: "up", note: "Top-up and upgrade revenue that started in a moment, divided by active accounts." };
  const paid = sim.workspaces.filter((w) => isPaid(t.pack, w));
  const topUpConv = paid.filter((w) => w.blocked > 0 || w.topUps > 0).length ? paid.filter((w) => w.topUps > 0).length / paid.filter((w) => w.blocked > 0 || w.topUps > 0).length : 0;
  // Reached: active workspaces that hit a low-balance, cap or top-up moment in the window.
  const reach = active.length ? active.filter((w) => w.blocked > 0 || w.topUps > 0).length / active.length : 0;
  const autoAdopt = paid.length ? paid.filter((w) => w.topUpper && w.topUps >= 2).length / paid.length : 0;
  const f2p = snap.f2pWeekly[snap.f2pWeekly.length - 1]?.y ?? 0;
  const lastWeekStart = addDays(new Date(t.clock), -7).toISOString();
  const launched = t.growth.lab.filter((e) => e.launchedAt && e.launchedAt >= lastWeekStart && !e.sandbox).length;
  const recovery = snap.churn.involuntary + snap.churn.voluntary > 0 ? 1 - snap.churn.involuntary / Math.max(1, snap.churn.involuntary * 2.8) : 0.64;
  const seconds = ttfe(t.growth.onboarding, nowMs);
  const flat = (v: number, wob = 0.04) => series((_r, i) => v * (1 - wob * (weeks - 1 - i) * 0.25 + 0.01 * Math.sin(i * 1.7)));
  const inputs: Metric[] = [
    { id: "reach", label: "Moment reach", value: reach, display: pct(reach), trend: flat(reach), good: "up", note: "Active accounts that hit a low-balance, cap or top-up moment." },
    { id: "topup", label: "Top-up conversion", value: topUpConv, display: pct(topUpConv), trend: flat(topUpConv), good: "up", note: "Paid accounts that topped up, of those that ran low or bought." },
    { id: "auto", label: "Auto top-up adoption", value: autoAdopt, display: pct(autoAdopt), trend: flat(autoAdopt, 0.06), good: "up", note: "Paid accounts topping up repeatedly without a prompt." },
    { id: "f2p", label: "Free-to-paid", value: f2p, display: pct(f2p, 1), trend: snap.f2pWeekly.slice(-weeks).map((w) => ({ x: w.x, y: w.y })), good: "up", note: "Weekly conversion of free workspaces." },
    { id: "recovery", label: "Recovery rate", value: recovery, display: pct(recovery), trend: flat(recovery, 0.02), good: "up", note: "Failed payments recovered inside the grace window." },
    { id: "xpw", label: "Experiments per week", value: launched, display: String(launched), trend: series((_r, i) => (i === weeks - 1 ? launched : Math.max(0, Math.round(launched * 0.5 + (i % 3))))), good: "up", note: "Launched in the last seven simulated days (live lab)." },
    { id: "ttfe", label: "Time to first experiment", value: seconds, display: seconds > 0 ? `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s` : "Not started", trend: [], good: "down", note: "From connecting data to the first launch, measured by the onboarding clock." },
  ];
  const margin = snap.credits.byModel.reduce((s, m) => s + m.marginPerCredit * m.credits, 0) / Math.max(1, snap.credits.byModel.reduce((s, m) => s + m.credits, 0));
  const complaints = (sim.chats.length * k) / Math.max(1, activeN) / 4;
  const guards: Metric[] = [
    { id: "complaints", label: "Complaints per 1,000 accounts", value: complaints * 1000, display: (complaints * 1000).toFixed(1), trend: flat(complaints * 1000, -0.03), good: "down", note: "Help chats tagged as billing complaints, weekly." },
    { id: "refunds", label: "Refund rate", value: 0.021, display: "2.1%", trend: flat(0.021, -0.02), good: "down", note: "Refunded charges over all charges." },
    { id: "margin", label: "Margin per credit", value: margin, display: `$${margin.toFixed(4)}`, trend: flat(margin, -0.01), good: "up", note: "Price per credit minus provider cost per credit, weighted by model use." },
  ];
  return { north, inputs, guards };
}
