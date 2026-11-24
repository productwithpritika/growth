// State changes for Bring Your Own Evals: register skills, bring data, run evals inside the
// budget, edit rubrics, overrides behind approval, the model-switch experiment, scheduled
// re-evals after provider changes and canary checks on running experiments.
import type { TenantState } from "@/core/types";
import type { ExperimentSpec } from "@/growth/types";
import { addDays, fnv1a } from "@/core/time";
import { fmtNum } from "@/core/format";
import { createExperiment } from "@/growth/lab-actions";
import { GUARDRAILS, MODEL_GUARDRAILS } from "@/growth/lab";
import { audit, gid } from "@/growth/state";
import type { Dataset, EvalRun, EvalsState, GateOverride, RubricCriterion, SkillManifest, SuiteId } from "@/platform/types";
import { approvedOverride } from "@/platform/gate";
import {
  canaryFloor,
  canaryReading,
  defaultRubric,
  gateFor,
  IMPACT_COHORT,
  latestRun,
  modelName,
  monthUsed,
  runCost,
  sandboxId,
  suitesFor,
  validateManifest,
} from "@/platform/evals";
import { segmentById } from "@/growth/population";
import { maskPII } from "@/platform/privacy";

export interface Res {
  t: TenantState;
  ok: boolean;
  text: string;
  id?: string;
}

const setEv = (t: TenantState, fn: (e: EvalsState) => EvalsState): TenantState => ({ ...t, platform: { ...t.platform, evals: fn(t.platform.evals) } });
const log = (t: TenantState, actor: string, what: string, decision: "approved" | "rejected" | "recorded" | "auto" = "recorded") => ({ ...t, growth: audit(t.growth, { ts: t.clock, actor, workflow: "experiments", what: `Evals · ${what}`, decision, thread: null, message: null, diff: [] }).g });

/** Register (or update) a skill after every check passes, including the vault and test call. */
export function registerSkill(t: TenantState, manifest: SkillManifest, secretFingerprint: string, by: string): Res {
  const v = validateManifest(manifest, true, true);
  if (!v.ok || !v.manifest) return { t, ok: false, text: v.checks.find((c) => !c.ok)?.detail ?? "Validation failed." };
  const m = v.manifest;
  const skill = { id: m.id, manifest: m, status: "live" as const, registeredAt: t.clock, vault: { ref: `vault://skills/${m.id}`, fingerprint: secretFingerprint }, checks: v.checks, inUse: m.defaultModel };
  let next = setEv(t, (e) => ({ ...e, skills: [...e.skills.filter((s) => s.id !== m.id), skill], rubrics: { ...e.rubrics, [m.id]: e.rubrics[m.id] ?? defaultRubric(m.id) }, schedule: { ...e.schedule, [m.id]: e.schedule[m.id] ?? "on-change" } }));
  next = log(next, by, `Registered skill ${m.name} (${m.transport.toUpperCase()})`, "approved");
  return { t: next, ok: true, text: `${m.name} is registered. Bring a dataset and run its first eval.`, id: m.id };
}

/** A draft registration from an agent (MCP register_skill): validated, never live until a person finishes it. */
export function draftSkill(t: TenantState, manifest: unknown, by: string): Res {
  const v = validateManifest(manifest);
  if (!v.manifest) return { t, ok: false, text: v.checks[0]?.detail ?? "Invalid manifest." };
  const m = v.manifest;
  if (t.platform.evals.skills.some((s) => s.id === m.id && s.status === "live")) return { t, ok: false, text: `${m.name} is already registered.` };
  const skill = { id: m.id, manifest: m, status: "draft" as const, registeredAt: t.clock, vault: null, checks: v.checks, inUse: m.defaultModel };
  const next = log(setEv(t, (e) => ({ ...e, skills: [...e.skills.filter((s) => s.id !== m.id), skill] })), by, `Drafted skill ${m.name}`);
  const failing = v.checks.filter((c) => !c.ok).map((c) => c.label);
  return { t: next, ok: true, text: `Drafted ${m.name}. ${failing.length ? `Still to do: ${failing.join(", ")}.` : "Ready to finish."}`, id: m.id };
}

export function addDataset(t: TenantState, ds: Dataset, by: string): Res {
  const next = log(setEv(t, (e) => ({ ...e, datasets: [ds, ...e.datasets.filter((d) => d.id !== ds.id)] })), by, `Added dataset ${ds.name} (${fmtNum(ds.rows)} rows, ${ds.source})`);
  return { t: next, ok: true, text: `${ds.name} added: ${fmtNum(ds.rows)} rows, kept ${ds.retentionDays} days in ${ds.region.toUpperCase()}.`, id: ds.id };
}

export function deleteDataset(t: TenantState, id: string, by: string, why = "Deleted on request"): Res {
  const ds = t.platform.evals.datasets.find((d) => d.id === id);
  if (!ds) return { t, ok: false, text: "Dataset not found." };
  let next = setEv(t, (e) => ({ ...e, datasets: e.datasets.filter((d) => d.id !== id) }));
  next = { ...next, platform: { ...next.platform, deletions: [{ ts: t.clock, what: `Dataset "${ds.name}" (${fmtNum(ds.rows)} rows)`, by: `${by} · ${why}` }, ...next.platform.deletions].slice(0, 200) } };
  next = log(next, by, `Deleted dataset ${ds.name}`);
  return { t: next, ok: true, text: `${ds.name} is deleted. Runs that used it keep their scores; the rows are gone.` };
}

export interface RunInput {
  skillId: string;
  datasetId: string;
  models: string[];
  suites?: SuiteId[];
  repeats: number;
  by: string;
  trigger: EvalRun["trigger"];
}

/** Start an eval: provisions an isolated synthetic tenant, checks the budget, records the run. */
export function startRun(t: TenantState, i: RunInput): Res {
  const ev = t.platform.evals;
  const skill = ev.skills.find((s) => s.id === i.skillId);
  if (!skill) return { t, ok: false, text: "Skill not found." };
  if (skill.status !== "live") return { t, ok: false, text: `${skill.manifest.name} is still a draft. Finish its registration first.` };
  const ds = ev.datasets.find((d) => d.id === i.datasetId && d.skillId === i.skillId);
  if (!ds) return { t, ok: false, text: "Pick a dataset for this skill." };
  const models = [...new Set([skill.manifest.defaultModel, ...i.models.filter((m) => skill.manifest.allowedModels.includes(m))])];
  if (models.length < 1) return { t, ok: false, text: "Pick at least one model." };
  const suites = i.suites?.length ? i.suites : suitesFor(skill, ds);
  const repeats = Math.max(1, Math.min(5, Math.round(i.repeats)));
  const credits = runCost(ds.rows, models.length, repeats, suites.length);
  const used = monthUsed(ev, t.clock);
  if (used + credits > ev.budget.monthly) return { t, ok: false, text: `This run needs ${fmtNum(credits)} eval credits; ${fmtNum(Math.max(0, ev.budget.monthly - used))} are left this month. Use fewer models, repeats or rows.` };
  const id = `run-${fnv1a(`${i.skillId}|${t.clock}|${ev.runs.length}|${models.join(",")}`).slice(0, 8)}`;
  const run: EvalRun = { id, skillId: i.skillId, datasetId: ds.id, models, suites, repeats, at: t.clock, sandboxTenant: sandboxId(t.pack, i.skillId, id), credits, by: i.by, rubric: (ev.rubrics[i.skillId] ?? defaultRubric(i.skillId)).map((c) => ({ ...c })), trigger: i.trigger };
  let next = setEv(t, (e) => ({ ...e, runs: [run, ...e.runs].slice(0, 120) }));
  next = log(next, i.by, `Ran ${skill.manifest.name} on ${models.length} models × ${repeats} repeats in ${run.sandboxTenant} (${fmtNum(credits)} eval credits)`, i.trigger === "manual" ? "recorded" : "auto");
  return { t: next, ok: true, text: `Eval finished in ${run.sandboxTenant}: ${models.length} models, ${fmtNum(ds.rows)} examples × ${repeats}. ${fmtNum(credits)} eval credits used.`, id };
}

export function setRubric(t: TenantState, skillId: string, rubric: RubricCriterion[], by: string): Res {
  const clean = rubric.filter((c) => c.label.trim()).map((c) => ({ ...c, weight: Math.max(0, Math.min(100, Math.round(c.weight))) }));
  if (!clean.length || clean.every((c) => c.weight === 0)) return { t, ok: false, text: "Give at least one criterion a weight." };
  const next = log(setEv(t, (e) => ({ ...e, rubrics: { ...e.rubrics, [skillId]: clean } })), by, `Edited the rubric for ${skillId}`);
  return { t: next, ok: true, text: "Rubric saved. Re-run the eval to score with it." };
}

export function setMargin(t: TenantState, margin: number): TenantState {
  return setEv(t, (e) => ({ ...e, margin: Math.max(0.5, Math.min(10, Math.round(margin * 2) / 2)) }));
}

export function setSchedule(t: TenantState, skillId: string, when: EvalsState["schedule"][string]): TenantState {
  return setEv(t, (e) => ({ ...e, schedule: { ...e.schedule, [skillId]: when } }));
}

export function requestOverride(t: TenantState, i: { skillId: string; model: string; experimentId: string | null; reason: string; by: string }): Res {
  const reason = maskPII(i.reason.trim());
  if (reason.length < 10) return { t, ok: false, text: "Give a reason of at least 10 characters. It goes in the audit log." };
  const o: GateOverride = { id: gid("ovr", t.clock), skillId: i.skillId, model: i.model, experimentId: i.experimentId, reason, requestedBy: i.by, status: "pending", decidedBy: null, at: t.clock };
  const next = log(setEv(t, (e) => ({ ...e, overrides: [o, ...e.overrides] })), i.by, `Requested a gate override for ${i.skillId} on ${modelName(i.model)}: ${reason}`);
  return { t: next, ok: true, text: "Override requested. It needs an approver.", id: o.id };
}

export function decideOverride(t: TenantState, id: string, approve: boolean, by: string): Res {
  const o = t.platform.evals.overrides.find((x) => x.id === id);
  if (!o || o.status !== "pending") return { t, ok: false, text: "No pending override." };
  const next = log(setEv(t, (e) => ({ ...e, overrides: e.overrides.map((x) => (x.id === id ? { ...x, status: approve ? "approved" : "rejected", decidedBy: by } : x)) })), by, `${approve ? "Approved" : "Rejected"} gate override for ${o.skillId} on ${modelName(o.model)} (requested by ${o.requestedBy}: ${o.reason})`, approve ? "approved" : "rejected");
  return { t: next, ok: true, text: approve ? "Override approved and audited. The launch is unblocked." : "Override rejected. The gate still blocks." };
}

/** One click: an experiment that switches the default model for the fastest-burning cohort. */
export function createModelExperiment(t: TenantState, skillId: string, model: string, by: string): Res {
  const ev = t.platform.evals;
  const skill = ev.skills.find((s) => s.id === skillId);
  if (!skill) return { t, ok: false, text: "Skill not found." };
  const seg = segmentById(t, IMPACT_COHORT);
  const from = skill.inUse;
  const spec: ExperimentSpec = {
    name: `${modelName(model)} as the default for ${skill.manifest.name}`,
    hypothesis: `If ${seg?.label ?? "heavy users"} run ${skill.manifest.name} on ${modelName(model)} instead of ${modelName(from)}, fewer run out of credits mid-month and more keep their subscription, with no drop in quality they notice.`,
    intervention: { type: "model-default", detail: `Default model for ${skill.manifest.name}: ${modelName(from)} → ${modelName(model)}`, variant: `${modelName(model)} by default` },
    audience: { id: IMPACT_COHORT, label: seg?.label ?? "Paid · buys top-ups", size: seg?.size ?? 1000 },
    allocation: 1,
    holdout: 0.1,
    metric: "Kept the subscription",
    metrics: ["Kept the subscription", "Bought a top-up", "Margin per credit"],
    baseRate: 0.86,
    mde: 0.03,
    layer: "pricing",
    guardrails: [...GUARDRAILS.map((g) => ({ ...g })), ...MODEL_GUARDRAILS.map((g) => ({ ...g }))],
    origin: "manual",
    sourceId: `model-${skillId}-${model}`,
    newCustomersOnly: false,
    patches: [],
    prior: [0.02, 0.06],
    skill: { id: skillId, from, to: model },
  };
  const r = createExperiment(t, spec, by);
  const next = log(r.t, by, `Drafted model-switch experiment for ${skill.manifest.name}: ${modelName(from)} → ${modelName(model)}`);
  return { t: next, ok: true, text: `Drafted "${spec.name}" for ${fmtNum(spec.audience.size)} workspaces with quality and rerun guardrails.`, id: r.id };
}

/** Change a skill's default for everyone, outside an experiment: gated like a launch. */
export function setSkillDefault(t: TenantState, skillId: string, model: string, by: string): Res {
  const ev = t.platform.evals;
  const skill = ev.skills.find((s) => s.id === skillId);
  if (!skill) return { t, ok: false, text: "Skill not found." };
  const g = gateFor(ev, t.pack, skillId, model);
  const o = g.state === "fail" || g.state === "none" ? approvedOverride(t, skillId, model, null) : null;
  if ((g.state === "fail" || g.state === "none") && !o) return { t, ok: false, text: `Blocked by the quality gate: ${g.reasons[0]}` };
  const next = log(setEv(t, (e) => ({ ...e, skills: e.skills.map((s) => (s.id === skillId ? { ...s, inUse: model } : s)), defaults: [{ skillId, from: skill.inUse, to: model, at: t.clock, by, override: o?.id ?? null }, ...e.defaults] })), by, `Default for ${skill.manifest.name}: ${modelName(skill.inUse)} → ${modelName(model)}${o ? ` (override ${o.id})` : ""}`, "approved");
  return { t: next, ok: true, text: `${skill.manifest.name} now defaults to ${modelName(model)}.` };
}

/** A provider ships a new build of a model: quality on each skill moves by `drift` points. */
export function providerChange(t: TenantState, model: string, drift: number, note: string): Res {
  const ev = t.platform.evals;
  const affected = ev.skills.filter((s) => s.manifest.allowedModels.includes(model));
  const change = { id: gid("pc", t.clock), model, at: t.clock, note, drift: Object.fromEntries(affected.map((s) => [s.id, drift])) };
  const next = setEv(t, (e) => ({ ...e, providerChanges: [change, ...e.providerChanges] }));
  return { t: next, ok: true, text: `${modelName(model)} changed. Scheduled re-evals and canaries pick it up on the next simulated day.` };
}

export function routeAlert(t: TenantState, id: string): TenantState {
  return setEv(t, (e) => ({ ...e, alerts: e.alerts.map((a) => (a.id === id ? { ...a, routed: true } : a)) }));
}

/** Daily: re-evaluate skills whose models changed since their last run, and run canaries on live model-switch experiments. */
export function stepEvals(t0: TenantState): TenantState {
  let t = t0;
  const ev = t.platform.evals;
  for (const s of ev.skills.filter((x) => x.status === "live")) {
    const last = latestRun(t.platform.evals, s.id);
    if (!last) continue;
    const change = t.platform.evals.providerChanges.find((c) => last.models.includes(c.model) && c.at > last.at && (c.drift[s.id] ?? 0) !== 0);
    const sched = t.platform.evals.schedule[s.id] ?? "on-change";
    const due = change || (sched === "daily") || (sched === "weekly" && new Date(t.clock).getTime() - new Date(last.at).getTime() >= 7 * 86_400_000);
    if (!due) continue;
    const r = startRun(t, { skillId: s.id, datasetId: last.datasetId, models: last.models, suites: last.suites, repeats: last.repeats, by: "Eval Agent", trigger: change ? "provider-change" : "scheduled" });
    if (!r.ok) continue;
    t = r.t;
    if (change) {
      const d = change.drift[s.id] ?? 0;
      const alert = { id: gid("al", t.clock), at: t.clock, skillId: s.id, model: change.model, text: `${s.manifest.name} on ${modelName(change.model)} moved ${d > 0 ? "+" : ""}${d.toFixed(1)} points after "${change.note}". Re-evaluated automatically.`, severity: (d <= -2 ? "blocked" : "watch") as "blocked" | "watch", routed: false };
      t = setEv(t, (e) => ({ ...e, alerts: [alert, ...e.alerts].slice(0, 40) }));
    }
  }
  // Canary evals on running experiments that switch a model: a drop past the floor trips the stop-loss.
  const lab = t.growth.lab.map((e) => {
    if (e.status !== "running" || !e.skill || e.sandbox) return e;
    const s = t.platform.evals.skills.find((x) => x.id === e.skill!.id);
    if (!s) return e;
    const q = canaryReading(t.platform.evals, e.skill.id, e.skill.to, t.clock, e.id);
    const floor = canaryFloor(t.platform.evals, e.skill.id, s.manifest.defaultModel, t.clock);
    t = setEv(t, (x) => ({ ...x, canary: { ...x.canary, [e.id]: [...(x.canary[e.id] ?? []), { date: t.clock, quality: q }].slice(-30) } }));
    if (q < floor) {
      const alert = { id: gid("al", t.clock), at: t.clock, skillId: e.skill.id, model: e.skill.to, text: `Canary eval for "${e.name}" scored ${q.toFixed(1)}, under the ${floor.toFixed(1)} floor. The experiment paused itself.`, severity: "blocked" as const, routed: false };
      t = setEv(t, (x) => ({ ...x, alerts: [alert, ...x.alerts].slice(0, 40) }));
      return { ...e, status: "paused" as const, pausedReason: `Stop-loss: canary eval quality ${q.toFixed(1)} fell under the floor of ${floor.toFixed(1)} (${modelName(e.skill.to)}).` };
    }
    return e;
  });
  return { ...t, growth: { ...t.growth, lab } };
}

/** Days until the oldest dataset reaches its retention limit. */
export function expiringDatasets(t: TenantState): { ds: Dataset; expiresAt: string; daysLeft: number }[] {
  return t.platform.evals.datasets
    .map((ds) => {
      const exp = addDays(new Date(ds.createdAt), ds.retentionDays);
      return { ds, expiresAt: exp.toISOString(), daysLeft: Math.ceil((exp.getTime() - new Date(t.clock).getTime()) / 86_400_000) };
    })
    .sort((a, b) => a.daysLeft - b.daysLeft);
}

export function manifestFromText(text: string): SkillManifest | null {
  return validateManifest(text).manifest;
}
