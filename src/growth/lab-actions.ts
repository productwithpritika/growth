// State changes for the Workbench loop: create, approve, launch, decide, ship behind approval,
// revert, record a learning, plus the breakage pool, rewards studio, churn levers and rescue.
import { skillGateIssues } from "@/platform/gate";
import type { TenantState } from "@/core/types";
import type { BreakageCommit, ExperimentSpec, GrowthState, LabExperiment, Learning, RewardRule, Verdict } from "@/growth/types";
import { applyPatches, launchIssues, newExperiment, scorecard } from "@/growth/lab";
import { audit, bonusCb, dayOf, gid, track } from "@/growth/state";
import { markFirstExperiment } from "@/growth/tour";
import { isLowValue, poolStatus, upsellCandidates } from "@/growth/analytics";
import { primaryMeter } from "@/core/pack";
import { fmtNum, fmtUsd } from "@/core/format";

type R = { t: TenantState; ok: boolean; text: string };
const g = (t: TenantState, fn: (g: GrowthState) => GrowthState): TenantState => ({ ...t, growth: fn(t.growth) });
const mapLab = (t: TenantState, id: string, fn: (e: LabExperiment) => LabExperiment) => g(t, (x) => ({ ...x, lab: x.lab.map((e) => (e.id === id ? fn(e) : e)) }));
const log = (t: TenantState, actor: string, what: string, diff: { path: string; before: string; after: string }[] = [], undo: GrowthState["audit"][number]["undo"] = null) => g(t, (x) => audit(x, { ts: t.clock, actor, workflow: "experiments", what, decision: "approved", thread: null, message: null, diff, undo }).g);

export function createExperiment(t: TenantState, spec: ExperimentSpec, owner: string, sandbox = false): { t: TenantState; id: string } {
  const id = gid("exp", `${t.clock}${spec.name}`);
  const e = { ...newExperiment(spec, id, owner, t.clock), sandbox: sandbox || undefined };
  return { t: g(t, (x) => ({ ...x, lab: [e, ...x.lab] })), id };
}

export function updateDraft(t: TenantState, id: string, patch: Partial<ExperimentSpec>): TenantState {
  return mapLab(t, id, (e) => (e.status === "draft" || e.status === "approved" ? { ...e, ...patch, status: "draft", approvedAt: null } : e));
}

export function deleteDraft(t: TenantState, id: string): TenantState {
  return g(t, (x) => ({ ...x, lab: x.lab.filter((e) => e.id !== id || (e.status !== "draft" && e.status !== "approved")) }));
}

export function approveExperiment(t: TenantState, id: string, actor: string): R {
  const e = t.growth.lab.find((x) => x.id === id);
  if (!e) return { t, ok: false, text: "Experiment not found." };
  const blocks = launchIssues(e, t.growth.lab, t.pack, skillGateIssues(t, e)).filter((i) => i.level === "block");
  if (blocks.length) return { t, ok: false, text: blocks[0].text };
  const next = log(mapLab(t, id, (x) => ({ ...x, status: "approved", approvedAt: t.clock })), actor, `Approved experiment: ${e.name}`, [{ path: `experiments.${id}.status`, before: e.status, after: "approved" }]);
  return { t: next, ok: true, text: `"${e.name}" is approved.` };
}

export function launchExperiment(t: TenantState, id: string, actor: string, persona: string): R {
  const e = t.growth.lab.find((x) => x.id === id);
  if (!e) return { t, ok: false, text: "Experiment not found." };
  if (e.status !== "approved") return { t, ok: false, text: "Approve the experiment before launching it." };
  const blocks = launchIssues(e, t.growth.lab, t.pack, skillGateIssues(t, e)).filter((i) => i.level === "block");
  if (blocks.length) return { t, ok: false, text: blocks[0].text };
  let next = log(mapLab(t, id, (x) => ({ ...x, status: "running", launchedAt: t.clock })), actor, `Launched experiment: ${e.name}`, [{ path: `experiments.${id}.status`, before: "approved", after: "running" }]);
  next = markFirstExperiment(next, id);
  const extra: string[] = [];
  if (e.guardrails.length) {
    const b = bonusCb(next, persona, "guardrailLaunch", `Launched "${e.name}" with guardrails`);
    next = b.t;
    if (b.amount) extra.push(`+${b.amount} CB credits for launching with guardrails`);
  }
  const hyp = next.growth.hypotheses;
  if (hyp.picked && e.sourceId === hyp.picked && !hyp.launched) {
    next = g(next, (x) => ({ ...x, hypotheses: { ...x.hypotheses, launched: id } }));
    const b = bonusCb(next, persona, "dailyExperiment", "Launched today's experiment");
    next = b.t;
    if (b.amount) extra.push(`+${b.amount} for today's experiment`);
  }
  next = g(next, (x) => track(x, { ts: new Date().toISOString(), sim: null, session: id, persona, kind: "experiment", name: "launch", detail: e.name }));
  return { t: next, ok: true, text: `"${e.name}" is running.${extra.length ? ` ${extra.join("; ")}.` : ""}` };
}

/** Ship to 100%: only at D7 or later, and applies any pack change with a revert. */
export function shipExperiment(t: TenantState, id: string, actor: string): R {
  const e = t.growth.lab.find((x) => x.id === id);
  if (!e) return { t, ok: false, text: "Experiment not found." };
  if (e.days.length < 7) return { t, ok: false, text: "Ship waits for the D7 read-out." };
  const sc = scorecard(e);
  let next = t;
  if (e.patches.length) next = { ...next, pack: applyPatches(next.pack, e.patches, "after") };
  next = mapLab(next, id, (x) => ({ ...x, status: "shipped", endedAt: t.clock, decision: { verdict: "Ship", by: actor, at: t.clock, note: sc.reason } }));
  next = log(next, actor, `Shipped to 100%: ${e.name}`, [{ path: `experiments.${id}.rollout`, before: `${Math.round(e.allocation * 100)}% test`, after: "100%" }, ...e.patches.map((p) => ({ path: p.path, before: String(p.before ?? "—"), after: String(p.after ?? "—") }))], { kind: "experiment", id });
  next = addLearning(next, e, "shipped", sc);
  return { t: next, ok: true, text: `"${e.name}" shipped to everyone. You can revert it from the experiment.` };
}

export function revertExperiment(t: TenantState, id: string, actor: string): R {
  const e = t.growth.lab.find((x) => x.id === id);
  if (!e || e.status !== "shipped") return { t, ok: false, text: "Only a shipped experiment can be reverted." };
  let next = t;
  if (e.patches.length) next = { ...next, pack: applyPatches(next.pack, e.patches, "before") };
  next = mapLab(next, id, (x) => ({ ...x, status: "reverted", decision: x.decision ? { ...x.decision, note: `${x.decision.note} Reverted by ${actor}.` } : null }));
  return { t: log(next, actor, `Reverted: ${e.name}`, [{ path: `experiments.${id}.rollout`, before: "100%", after: "0% (control everywhere)" }]), ok: true, text: `"${e.name}" is reverted; everyone sees the control again.` };
}

export function decideExperiment(t: TenantState, id: string, verdict: Exclude<Verdict, "Ship" | "Too early" | "Directional">, actor: string): R {
  const e = t.growth.lab.find((x) => x.id === id);
  if (!e) return { t, ok: false, text: "Experiment not found." };
  if (e.days.length < 7 && verdict !== "Kill") return { t, ok: false, text: "Decisions wait for the D7 read-out." };
  const sc = scorecard(e);
  if (verdict === "Hold") {
    const next = mapLab(t, id, (x) => ({ ...x, status: "running", decision: { verdict, by: actor, at: t.clock, note: "Held for another week." } }));
    return { t: log(next, actor, `Held for another week: ${e.name}`), ok: true, text: `"${e.name}" keeps running until day 14.` };
  }
  let next = mapLab(t, id, (x) => ({ ...x, status: "killed", endedAt: t.clock, decision: { verdict, by: actor, at: t.clock, note: sc.reason } }));
  next = log(next, actor, `Killed: ${e.name}`, [{ path: `experiments.${id}.status`, before: e.status, after: "killed" }]);
  next = addLearning(next, e, "killed", sc);
  return { t: next, ok: true, text: `"${e.name}" stopped. Everyone sees the control.` };
}

export function resumeAfterStopLoss(t: TenantState, id: string, actor: string, note: string): R {
  const e = t.growth.lab.find((x) => x.id === id);
  if (!e || e.status !== "paused") return { t, ok: false, text: "Only a paused experiment can resume." };
  const next = mapLab(t, id, (x) => ({ ...x, status: "running", pausedReason: null, guardrails: x.guardrails.map((gg) => (e.pausedReason?.toLowerCase().includes(gg.label.toLowerCase()) ? { ...gg, maxWorsePts: gg.maxWorsePts * 6 } : gg)) }));
  return { t: log(next, actor, `Resumed after stop-loss: ${e.name}. ${note}`), ok: true, text: `"${e.name}" resumed with a wider guardrail. That decision is in the audit log.` };
}

function addLearning(t: TenantState, e: LabExperiment, outcome: Learning["outcome"], sc: ReturnType<typeof scorecard>): TenantState {
  const c = sc.decision.find((l) => l.id === "converted")?.at[7];
  const l: Learning = { id: gid("lrn", t.clock), ts: t.clock, title: e.name, hypothesis: e.hypothesis, outcome, lift: c ? c.lift : null, note: sc.reason, experimentId: e.id };
  return g(t, (x) => ({ ...x, learnings: [l, ...x.learnings] }));
}

export function recordLearning(t: TenantState, persona: string, title: string, note: string, experimentId: string | null): R {
  const l: Learning = { id: gid("lrn", t.clock), ts: t.clock, title, hypothesis: "", outcome: "held", lift: null, note, experimentId };
  let next = g(t, (x) => ({ ...x, learnings: [l, ...x.learnings] }));
  next = g(next, (x) => audit(x, { ts: t.clock, actor: `merchant:${persona}`, workflow: "experiments", what: `Recorded a learning: ${title}`, decision: "recorded", thread: null, message: null, diff: [] }).g);
  const b = bonusCb(next, persona, "learning", `Recorded a learning: ${title}`);
  return { t: b.t, ok: true, text: `Learning recorded.${b.amount ? ` +${b.amount} CB credit.` : ""}` };
}

export function pickHypothesis(t: TenantState, id: string): TenantState {
  return g(t, (x) => ({ ...x, hypotheses: { ...x.hypotheses, day: dayOf(t.clock), picked: id } }));
}

// ------------------------------------------------------------------ audiences

export function saveAudience(t: TenantState, segment: string, label: string, size: number, slice: string): TenantState {
  const a = { id: gid("aud", t.clock), ts: t.clock, label, segment, size, slice };
  return g(t, (x) => ({ ...x, audiences: [a, ...x.audiences.filter((y) => !(y.segment === segment && y.slice === slice))] }));
}

// ------------------------------------------------------------------ breakage pool

export function setBreakagePolicy(t: TenantState, recognisedPct: number, fundingPct: number, actor: string): TenantState {
  const before = t.growth.breakage;
  return g(t, (x) => audit({ ...x, breakage: { ...x.breakage, recognisedPct, fundingPct } }, { ts: t.clock, actor, workflow: "breakage", what: "Breakage policy changed", decision: "approved", thread: null, message: null, diff: [{ path: "breakage.recognisedPct", before: `${before.recognisedPct}%`, after: `${recognisedPct}%` }, { path: "breakage.fundingPct", before: `${before.fundingPct}%`, after: `${fundingPct}%` }] }).g);
}

/** Fund promotional credits from the pool. Refuses anything beyond the funding rule, and never moves one customer's paid credits to another. */
export function fundFromPool(t: TenantState, kind: BreakageCommit["kind"], label: string, accounts: number, creditsEach: number, actor: string): R {
  const prim = primaryMeter(t.pack);
  const credits = accounts * creditsEach;
  const usd = Math.round(credits * prim.pricePerUnit);
  const pool = poolStatus(t, t.growth.breakage);
  if (kind !== "nudge" && usd > pool.available) {
    return { t, ok: false, text: `Refused: ${fmtUsd(usd, 0)} is more than the ${fmtUsd(pool.available, 0)} the funding rule allows (${t.growth.breakage.fundingPct}% of forecast breakage, minus ${fmtUsd(pool.committed, 0)} committed). Lower the amount or the audience.` };
  }
  if (kind === "upsell" && accounts > upsellCandidates(t).total) return { t, ok: false, text: "That is more accounts than there are candidates." };
  const c: BreakageCommit = { id: gid("brk", t.clock), ts: t.clock, kind, label, accounts, credits: kind === "nudge" ? 0 : credits, usd: kind === "nudge" ? 0 : usd, expiresDays: t.pack.growth.breakage.promoExpiryDays };
  const next = g(t, (x) => audit({ ...x, breakage: { ...x.breakage, commits: [c, ...x.breakage.commits] } }, { ts: t.clock, actor, workflow: "breakage", what: `${label}: ${fmtNum(accounts)} accounts${kind === "nudge" ? "" : ` · ${fmtNum(credits)} ${prim.label} (${fmtUsd(usd, 0)})`}`, decision: "approved", thread: null, message: null, diff: [{ path: "breakage.committed", before: fmtUsd(pool.committed, 0), after: fmtUsd(pool.committed + c.usd, 0) }] }).g);
  return { t: next, ok: true, text: kind === "nudge" ? `Nudge queued for ${fmtNum(accounts)} owners of expiring credits.` : `${fmtNum(credits)} promotional ${prim.label} funded for ${fmtNum(accounts)} accounts, expiring in ${c.expiresDays} days.` };
}

// ------------------------------------------------------------------ rewards studio

export function saveRewardRule(t: TenantState, rule: RewardRule, actor: string): R {
  if (isLowValue(rule.action)) return { t, ok: false, text: `"${rule.action}" is low-value behaviour. Rewards go to actions that create value (a qualifying run, a verified result, a published template), never to logins or clicks.` };
  if (rule.amount <= 0 || rule.capPerMonth < rule.amount) return { t, ok: false, text: "The monthly cap must be at least one reward." };
  const exists = t.growth.rewardRules.some((r) => r.id === rule.id);
  const next = g(t, (x) => audit({ ...x, rewardRules: exists ? x.rewardRules.map((r) => (r.id === rule.id ? rule : r)) : [rule, ...x.rewardRules] }, { ts: t.clock, actor, workflow: "rewards", what: `${exists ? "Updated" : "Created"} reward rule: ${rule.label}`, decision: "approved", thread: null, message: null, diff: [{ path: `rewards.${rule.id}`, before: exists ? "previous" : "", after: `${rule.amount} for "${rule.action}", cap ${rule.capPerMonth}, ${rule.expiryDays}-day expiry, ${rule.funding}` }] }).g);
  return { t: next, ok: true, text: `Reward rule "${rule.label}" saved as ${rule.status}.` };
}

export function setRuleStatus(t: TenantState, id: string, status: RewardRule["status"]): TenantState {
  return g(t, (x) => ({ ...x, rewardRules: x.rewardRules.map((r) => (r.id === id ? { ...r, status } : r)) }));
}

// ------------------------------------------------------------------ churn arrest

export function setLevers(t: TenantState, patch: Partial<GrowthState["levers"]>, actor: string): TenantState {
  const before = t.growth.levers;
  const after = { ...before, ...patch };
  const diff = (Object.keys(patch) as (keyof GrowthState["levers"])[]).map((k) => ({ path: `dunning.${k}`, before: String(before[k]), after: String(after[k]) }));
  let next = g(t, (x) => audit({ ...x, levers: after }, { ts: t.clock, actor, workflow: "levers", what: "Dunning levers changed", decision: "approved", thread: null, message: null, diff }).g);
  if (patch.graceDays != null) next = { ...next, pack: { ...next.pack, hub: { ...next.pack.hub, dunning: { ...next.pack.hub.dunning, graceDays: patch.graceDays } } } };
  return next;
}

export function rescue(t: TenantState, ids: string[], actions: string[], actor: string): TenantState {
  return g(t, (x) => audit({ ...x, rescued: [...new Set([...x.rescued, ...ids])] }, { ts: t.clock, actor, workflow: "dunning", what: `Dunning Rescue: ${ids.length} actions approved`, decision: "approved", thread: null, message: null, diff: actions.slice(0, 8).map((a, i) => ({ path: `rescue.${ids[i]}`, before: "queued", after: a })) }).g);
}

export function setGrandfathering(t: TenantState, policy: GrowthState["grandfathering"]): TenantState {
  return g(t, (x) => ({ ...x, grandfathering: policy }));
}

export function askAutonomy(t: TenantState, wf: keyof GrowthState["autonomy"], level: GrowthState["autonomy"][keyof GrowthState["autonomy"]], actor: string): TenantState {
  const before = t.growth.autonomy[wf];
  return g(t, (x) => audit({ ...x, autonomy: { ...x.autonomy, [wf]: level } }, { ts: t.clock, actor, workflow: wf, what: `Autonomy for ${wf} changed`, decision: "approved", thread: null, message: null, diff: [{ path: `autonomy.${wf}`, before, after: level }] }).g);
}
