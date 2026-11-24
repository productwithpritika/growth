// The agentic tour (Phase 3 §3.5): do, don't show. The agent drives the real Workbench in a
// sandbox copy; the only live write is the launch, and only after the person approves it.
import type { TenantState } from "@/core/types";
import type { OnboardingState, TourState, TourStepId } from "@/growth/types";
import { initialTour, track, bonusCb, audit } from "@/growth/state";
import { hypothesesFor, hypothesisTitle, specFromHypothesis } from "@/growth/ideas";
import { newExperiment } from "@/growth/lab";
import { segmentById } from "@/growth/population";
import { fmtNum } from "@/core/format";
import { fnv1a } from "@/core/time";

export interface TourStep {
  id: TourStepId;
  title: string;
  you: string;
  narrate: (t: TenantState) => string;
}

export const TOUR_STEPS: TourStep[] = [
  { id: "open-cohorts", title: "Open the cohort view", you: "Open Cohorts in the side navigation.", narrate: () => "I'm opening Cohorts in a sandbox copy of your Workbench. Nothing I do here touches live configuration." },
  {
    id: "select-cohort",
    title: "Select the at-risk free cohort",
    you: "Select the cohort 'quiet before a first enrichment' in the At risk lane.",
    narrate: (t) => {
      const s = segmentById(t, "free-quiet");
      return s ? `The largest at-risk group is free users who go quiet before a first enrichment: ${fmtNum(s.size)} workspaces, ${s.stakeLabel}.` : "Selecting the at-risk free cohort.";
    },
  },
  { id: "ask-why", title: "Ask Ask CB why they leave", you: "Open Ask CB and ask why quiet free users leave.", narrate: () => "Now I'll ask Ask CB why they leave. Sandbox answers don't use CB credits." },
  { id: "hypotheses", title: "Receive three ranked hypotheses", you: "Wait for the answer with three hypotheses.", narrate: () => "Ask CB answers first, then shows the evidence and three ranked hypotheses." },
  {
    id: "pick",
    title: "Pick one",
    you: "Pick a hypothesis in the answer.",
    narrate: (t) => {
      const h = hypothesesFor(t, "free-quiet", t.clock.slice(0, 10))[0];
      return h ? `I recommend "${hypothesisTitle(h.id)}". ${h.why.replace(/^Recommended: /, "")}` : "Picking the recommended hypothesis.";
    },
  },
  { id: "draft", title: "Draft the experiment", you: "Draft an experiment from the picked hypothesis.", narrate: () => "Drafting the experiment: audience, variant, a holdout, all four guardrails and a sample-size estimate." },
  { id: "scorecard", title: "Preview the D1, D3, D7 scorecard", you: "Open the scorecard preview on the draft.", narrate: () => "This is how results will read: D1 leading signals, D3 direction, D7 the decision. No winner before D7." },
  { id: "approval", title: "Request approval", you: "Request approval to launch.", narrate: () => "I've requested approval. Launching is the only live change, and only you can approve it." },
  { id: "launch", title: "Launch", you: "Approve the launch in the sheet.", narrate: () => "Waiting for your approval. Tap Approve to launch; voice can't approve." },
];

export function startTour(t: TenantState, persona: string, opts: { voice?: boolean; reducedMotion?: boolean } = {}): TenantState {
  const prev = t.growth.tours[persona] ?? initialTour(persona);
  const sessionId = `tour-${persona}-${fnv1a(`${Date.now()}`).slice(0, 6)}`;
  const tour: TourState = {
    ...initialTour(persona),
    status: "running",
    voice: opts.voice ?? prev.voice,
    reducedMotion: opts.reducedMotion ?? prev.reducedMotion,
    startedAt: new Date().toISOString(),
    sessionId,
    sandbox: { lab: t.growth.lab.map((e) => ({ ...e })), threads: [], audiences: [...t.growth.audiences] },
  };
  const g = track({ ...t.growth, tours: { ...t.growth.tours, [persona]: tour } }, { ts: new Date().toISOString(), sim: ttfe(t.growth.onboarding), session: sessionId, persona, kind: "tour", name: "tour.start", detail: "Agentic tour started" });
  return { ...t, growth: g };
}

export function setTour(t: TenantState, persona: string, patch: Partial<TourState>): TenantState {
  const cur = t.growth.tours[persona] ?? initialTour(persona);
  return { ...t, growth: { ...t.growth, tours: { ...t.growth.tours, [persona]: { ...cur, ...patch } } } };
}

export function completeStep(t: TenantState, persona: string, by: "agent" | "you"): TenantState {
  const tr = t.growth.tours[persona];
  if (!tr) return t;
  const step = TOUR_STEPS[tr.step];
  if (!step || tr.completed.some((c) => c.id === step.id)) return t;
  const next = setTour(t, persona, { completed: [...tr.completed, { id: step.id, by, at: new Date().toISOString() }], step: Math.min(TOUR_STEPS.length - 1, tr.step + 1) });
  return { ...next, growth: track(next.growth, { ts: new Date().toISOString(), sim: ttfe(t.growth.onboarding), session: tr.sessionId, persona, kind: "tour", name: `step.${step.id}`, detail: by === "you" ? "taken over" : "agent" }) };
}

/** Sandbox draft from the picked hypothesis. */
export function draftFromPick(t: TenantState, persona: string, owner: string): { t: TenantState; id: string } {
  const tr = t.growth.tours[persona];
  const hs = hypothesesFor(t, "free-quiet", t.clock.slice(0, 10));
  const h = hs.find((x) => x.id === tr?.picked) ?? hs[0];
  const id = `exp-tour-${fnv1a(`${tr?.sessionId}:${h.id}`).slice(0, 6)}`;
  if (t.growth.lab.some((e) => e.id === id)) return { t, id };
  const e = { ...newExperiment(specFromHypothesis(t, h, "tour"), id, owner, t.clock), sandbox: true };
  return { t: { ...t, growth: { ...t.growth, lab: [e, ...t.growth.lab] } }, id };
}

export function ttfe(o: OnboardingState, nowMs = Date.now()): number {
  if (o.firstExperimentAt != null) return o.firstExperimentAt;
  if (o.stage === "consent" || !o.connectedAt) return 0;
  if (!o.realSince) return o.simSeconds;
  return o.simSeconds + Math.max(0, (nowMs - new Date(o.realSince).getTime()) / 1000);
}

/** Stop the Time to first experiment clock at the first launch, wherever it happened. */
export function markFirstExperiment(t: TenantState, id: string): TenantState {
  const o = t.growth.onboarding;
  if (o.firstExperimentAt != null || !o.connectedAt) return t;
  const at = Math.round(ttfe(o));
  const g = track({ ...t.growth, onboarding: { ...o, firstExperimentAt: at, firstExperimentId: id, stage: o.stage === "consent" ? o.stage : "done" } }, { ts: new Date().toISOString(), sim: at, session: o.sessionId, persona: "nia", kind: "experiment", name: "first-experiment", detail: `Time to first experiment ${Math.floor(at / 60)}:${String(at % 60).padStart(2, "0")}` });
  return { ...t, growth: g };
}

/** The approval: copy the sandbox draft into the live lab and launch it. The only live write the tour makes. */
export function launchFromTour(live: TenantState, persona: string, by: string): { t: TenantState; id: string | null } {
  const tr = live.growth.tours[persona];
  const draft = tr?.sandbox?.lab.find((e) => e.id === tr.draftId);
  if (!tr || !draft) return { t: live, id: null };
  const id = draft.id.replace("exp-tour-", "exp-");
  const launched = { ...draft, id, sandbox: undefined, status: "running" as const, approvedAt: live.clock, launchedAt: live.clock, owner: by };
  let t: TenantState = { ...live, growth: { ...live.growth, lab: [launched, ...live.growth.lab.filter((e) => e.id !== id)] } };
  t = { ...t, growth: audit(t.growth, { ts: t.clock, actor: `merchant:${persona}`, workflow: "experiments", what: `Approved and launched from the tour: ${draft.name}`, decision: "approved", thread: tr.threadId, message: null, diff: [{ path: "experiments", before: "", after: `${draft.name} · running` }] }).g };
  t = markFirstExperiment(t, id);
  t = bonusCb(t, persona, "guardrailLaunch", `Launched "${draft.name}" with guardrails`).t;
  const done = setTour(t, persona, { status: "done", launchedId: id, approvalOpen: false, completed: [...tr.completed.filter((c) => c.id !== "launch"), { id: "launch", by: "you", at: new Date().toISOString() }], sandbox: null });
  return { t: { ...done, growth: track(done.growth, { ts: new Date().toISOString(), sim: done.growth.onboarding.firstExperimentAt, session: tr.sessionId, persona, kind: "tour", name: "tour.launch", detail: draft.name }) }, id };
}

export function exitTour(t: TenantState, persona: string): TenantState {
  const tr = t.growth.tours[persona];
  if (!tr) return t;
  const next = setTour(t, persona, { status: tr.status === "done" ? "done" : "exited", sandbox: null, approvalOpen: false });
  return { ...next, growth: track(next.growth, { ts: new Date().toISOString(), sim: null, session: tr.sessionId, persona, kind: "tour", name: "tour.exit", detail: `Left at step ${tr.step + 1}` }) };
}
