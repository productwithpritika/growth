// Growth state on TenantState: seeding, the daily step the time machine drives, telemetry,
// the growth audit log, CB Daily 5 and Memory cards.
import type { TenantState } from "@/core/types";
import type { TenantPack } from "@/tenants/schema";
import type { Autonomy, CbAllowance, GrowthAudit, GrowthState, LabExperiment, Learning, MemoryCard, RewardRule, TelemetryEvent, TourState, Workflow } from "@/growth/types";
import { initialOnboarding, type CardDraft } from "@/growth/onboarding";
import { GUARDRAILS, newExperiment, preRun, stepLab } from "@/growth/lab";
import { METRIC_BASE, plays, specFromPlay } from "@/growth/ideas";
import { entryPrice, segmentById } from "@/growth/population";
import { addDays, fnv1a } from "@/core/time";

export const dayOf = (iso: string) => iso.slice(0, 10);

export function initialTour(persona: string): TourState {
  return {
    status: "idle",
    step: 0,
    control: "agent",
    completed: [],
    picked: null,
    draftId: null,
    threadId: null,
    previewed: false,
    approvalOpen: false,
    launchedId: null,
    voice: false,
    reducedMotion: false,
    startedAt: null,
    sessionId: `tour-${persona}-0`,
    sandbox: null,
  };
}

const LEGACY_AUDIENCE: Record<string, string> = { "free-capped": "free-blocked", "free-active": "free-activated", "paid-hot": "paid-topup", "paid-idle": "quiet-credits", "payment-failing": "card-expiring" };

/** Seeded experiments: the pack's demo experiments mapped onto the lab, plus a running test that will trip its stop-loss. */
function seedLab(t: Pick<TenantState, "pack" | "population" | "clock"> & { growth: { anchor: string } }, clockIso: string): LabExperiment[] {
  const pack = t.pack;
  const price = entryPrice(pack);
  const clock = new Date(clockIso);
  const out: LabExperiment[] = [];
  const ps = plays(pack);
  for (const e of pack.demo.experiments) {
    const audId = LEGACY_AUDIENCE[e.cohort] ?? "paid-all";
    const seg = segmentById(t, audId);
    const play = ps.find((p) => p.audience === audId) ?? ps[0];
    const spec = specFromPlay(t, play, "seed");
    const metric = METRIC_BASE[e.metric] != null ? e.metric : spec.metric;
    const c = e.arms[0];
    const v = e.arms[1];
    const observed = c && v && c.exposed && v.exposed && c.converted ? (v.converted / v.exposed - c.converted / c.exposed) / (c.converted / c.exposed) : null;
    const prior: [number, number] = observed != null ? [observed * 0.85, observed * 1.1] : spec.prior;
    // Seeded tests keep the reach their arms recorded.
    const reach = c && v ? Math.round(((c.exposed + v.exposed) * (e.status === "done" ? 3 : 1)) / (spec.allocation * (1 - spec.holdout))) : seg?.size ?? 0;
    const x = newExperiment(
      {
        ...spec,
        name: e.name,
        hypothesis: e.hypothesis,
        audience: { id: audId, label: seg?.label ?? audId, size: reach },
        metric,
        metrics: [metric, ...spec.metrics.filter((m) => m !== metric)],
        baseRate: c && c.exposed ? Math.max(0.01, c.converted / c.exposed) : METRIC_BASE[metric] ?? spec.baseRate,
        prior,
        sourceId: e.id,
      },
      e.id,
      e.owner,
      addDays(clock, -((e.startedDaysAgo ?? 2) + 2)).toISOString(),
    );
    if (e.status === "draft") {
      out.push(x);
      continue;
    }
    const days = e.status === "done" ? 7 : Math.min(e.startedDaysAgo ?? 5, 5);
    const launched = addDays(clock, -days).toISOString();
    let run = preRun(x, launched, days, price);
    if (e.status === "done") {
      run = { ...run, status: e.decision === "stop" ? "killed" : "shipped", endedAt: addDays(new Date(launched), 8).toISOString(), decision: { verdict: e.decision === "stop" ? "Kill" : "Ship", by: e.owner, at: addDays(new Date(launched), 8).toISOString(), note: "Seeded read-out" } };
    } else if (run.status === "readout") run = { ...run, status: "running" };
    out.push(run);
  }
  // The stop-loss scenario: a deep win-back discount that erodes gross margin. Fast-forward one day and it pauses itself.
  const wb = ps.find((p) => p.id === "winback-expiring") ?? ps[0];
  const spec = specFromPlay(t, wb, "seed");
  const stop = newExperiment(
    { ...spec, name: "Win-back at 40% off", hypothesis: "If quiet paid users get 40% off their next month, more come back within 14 days.", intervention: { type: "offer", detail: "40% off the next month for quiet paid users", variant: "40% off next month" }, layer: "retention", allocation: 1, holdout: 0.05, baseRate: 0.45, prior: [0.08, 0.12] },
    "exp-winback-40",
    "Nia",
    addDays(clock, -2).toISOString(),
    { margin: -14 },
  );
  // Launched this morning: the first simulated day (one Time machine step) trips the margin guardrail.
  out.push({ ...stop, status: "running", approvedAt: clockIso, launchedAt: clockIso });
  return out;
}

function seedLearnings(clockIso: string): Learning[] {
  const c = new Date(clockIso);
  const at = (d: number) => addDays(c, -d).toISOString();
  return [
    { id: "lrn-wall", ts: at(70), title: "Upgrade wall at the cap", hypothesis: "A hard upgrade wall at the free cap converts better than a soft limit.", outcome: "killed", lift: -0.08, note: "Conversion fell 8% and support tickets doubled. People who hit a wall mid-run leave.", experimentId: null },
    { id: "lrn-preview", ts: at(33), title: "Dollar run-cost preview", hypothesis: "Showing the dollar cost before every run raises top-up purchases.", outcome: "shipped", lift: 0.18, note: "Top-up purchases up 18% with fewer bill-shock tickets. Shipped to 100%.", experimentId: "exp-preview" },
    { id: "lrn-annual5", ts: at(21), title: "Annual nudge on day 5", hypothesis: "An annual offer early in the cycle locks in commitment.", outcome: "killed", lift: -0.02, note: "Too early: users had not seen value yet. Retest on day 25.", experimentId: null },
    { id: "lrn-bonus", ts: at(9), title: "Rollover bonus as a save offer", hypothesis: "Adding rollover credits saves idle paid accounts.", outcome: "held", lift: 0.04, note: "Directional but the interval included zero. Held for another cycle.", experimentId: null },
  ];
}

function seedRewardRules(pack: TenantPack, clockIso: string): RewardRule[] {
  const prim = pack.meters[0];
  const s = pack.hub.spark;
  const rules: RewardRule[] = [
    { id: "rr-spark", label: s.label, action: `Run a table of ${s.minRows}+ rows`, amount: s.amount, meter: s.meter ?? prim.id, capPerMonth: s.monthlyCap, expiryDays: s.expiryDays, eligibility: "Activated free users", funding: "breakage", status: "live", createdAt: clockIso },
  ];
  for (const r of pack.rewards) rules.push({ id: `rr-${r.id}`, label: r.label, action: r.label, amount: r.amount, meter: r.meter, capPerMonth: r.amount, expiryDays: r.expiryDays ?? 30, eligibility: "Any workspace", funding: "marketing", status: "live", createdAt: clockIso });
  rules.push({ id: "rr-verify", label: "Verify before you send", action: "Verify emails before sending a sequence", amount: 10, meter: prim.id, capPerMonth: 20, expiryDays: 14, eligibility: "Paid workspaces", funding: "breakage", status: "draft", createdAt: clockIso });
  return rules;
}

export function initGrowth(t: Pick<TenantState, "pack" | "population" | "clock">, clockIso: string): GrowthState {
  const anchor = clockIso;
  const ctx = { ...t, growth: { anchor } };
  return {
    anchor,
    onboarding: initialOnboarding(`onb-${fnv1a(clockIso).slice(0, 6)}`),
    memory: [],
    telemetry: [],
    tours: { nia: initialTour("nia"), sam: initialTour("sam") },
    lab: seedLab(ctx, clockIso),
    hypotheses: { day: dayOf(clockIso), picked: null, launched: null, history: [] },
    learnings: seedLearnings(clockIso),
    audiences: [],
    ask: { threads: [], provider: "scripted", drill: "none" },
    cb: {},
    autonomy: { grants: "execute", offers: "draft", experiments: "execute", dunning: "draft" },
    autoSpend: { day: dayOf(clockIso), grants: 0 },
    audit: [],
    playbook: [],
    offers: [],
    breakage: { recognisedPct: t.pack.growth.breakage.recognisedPct, fundingPct: t.pack.growth.breakage.fundingPct, commits: [] },
    rewardRules: seedRewardRules(t.pack, clockIso),
    levers: { graceCredits: true, retry: "standard", message: "plain", backupPrompt: true, graceDays: t.pack.hub.dunning.graceDays },
    rescued: [],
    grandfathering: "12-months",
  };
}

/** Older saved data has no growth section: add one without touching anything else. */
export function withGrowth(t: TenantState): TenantState {
  if (t.growth && t.growth.onboarding && Array.isArray(t.growth.lab) && t.growth.levers) return t;
  return { ...t, growth: initGrowth(t, t.clock) };
}

// ------------------------------------------------------------------ helpers that return a new growth state

export function setGrowth(t: TenantState, fn: (g: GrowthState) => GrowthState): TenantState {
  return { ...t, growth: fn(t.growth) };
}

let seq = 0;
export function gid(prefix: string, at: string): string {
  seq = (seq + 1) % 1_000_000;
  return `${prefix}_${fnv1a(`${at}|${seq}|${Math.random()}`).slice(0, 8)}`;
}

export function track(g: GrowthState, e: Omit<TelemetryEvent, "id">): GrowthState {
  const ev: TelemetryEvent = { ...e, id: gid("ev", e.ts) };
  return { ...g, telemetry: [ev, ...g.telemetry].slice(0, 800) };
}

export function audit(g: GrowthState, a: Omit<GrowthAudit, "id">): { g: GrowthState; id: string } {
  const id = `aud_${fnv1a(`${a.ts}|${a.what}|${g.audit.length}`)}`;
  return { g: { ...g, audit: [{ ...a, id }, ...g.audit].slice(0, 400) }, id };
}

export function learnCards(g: GrowthState, drafts: CardDraft[], at: string): GrowthState {
  if (!drafts.length) return g;
  const memory = [...g.memory];
  for (const d of drafts) {
    const i = memory.findIndex((c) => c.id === d.id);
    if (i < 0) memory.push({ ...d, updatedAt: at, edited: false, forgotten: false, history: [] });
    else if (!memory[i].edited && !memory[i].forgotten) memory[i] = { ...memory[i], ...d, updatedAt: at };
  }
  return { ...g, memory };
}

export function editCard(g: GrowthState, id: string, value: string, by: string, at: string): GrowthState {
  return { ...g, memory: g.memory.map((c) => (c.id === id ? { ...c, value, edited: true, confidence: "high", source: `Edited by ${by}`, updatedAt: at, history: [...c.history, { at, by, from: c.value, to: value }] } : c)) };
}

export function forgetCard(g: GrowthState, id: string, forgotten: boolean, by: string, at: string): GrowthState {
  return { ...g, memory: g.memory.map((c) => (c.id === id ? { ...c, forgotten, updatedAt: at, history: [...c.history, { at, by, from: forgotten ? "remembered" : "forgotten", to: forgotten ? "forgotten" : "remembered" }] } : c)) };
}

export function liveCards(g: GrowthState): MemoryCard[] {
  return g.memory.filter((c) => !c.forgotten);
}

// ------------------------------------------------------------------ CB Daily 5

export function cbAllowance(t: TenantState, persona: string): CbAllowance & { free: number; remaining: number; bonusTotal: number } {
  const day = dayOf(t.clock);
  const cfg = t.pack.growth.assistant.daily;
  const a0 = t.growth.cb[persona];
  const a: CbAllowance = a0 && a0.day === day ? a0 : { day, used: 0, bonus: [], bought: a0?.bought ?? 0, log: [] };
  const bonusTotal = a.bonus.reduce((s, b) => s + b.amount, 0);
  return { ...a, free: cfg.free, bonusTotal, remaining: Math.max(0, cfg.free + bonusTotal + a.bought - a.used) };
}

export function spendCb(t: TenantState, persona: string, amount: number, reason: string, thread: string | null): TenantState {
  if (amount <= 0) return t;
  const a = cbAllowance(t, persona);
  // Bought credits are used last: spend them only once the day's free and bonus credits are gone.
  const freeLeft = Math.max(0, a.free + a.bonusTotal - a.used);
  const fromBought = Math.max(0, amount - freeLeft);
  const next: CbAllowance = { day: a.day, used: a.used + amount - fromBought, bonus: a.bonus, bought: Math.max(0, a.bought - fromBought), log: [{ at: t.clock, amount: -amount, reason, thread }, ...a.log].slice(0, 60) };
  return { ...t, growth: { ...t.growth, cb: { ...t.growth.cb, [persona]: next } } };
}

export function bonusCb(t: TenantState, persona: string, reason: keyof TenantPack["growth"]["assistant"]["daily"]["bonuses"], label: string): { t: TenantState; amount: number } {
  const amount = t.pack.growth.assistant.daily.bonuses[reason];
  const a = cbAllowance(t, persona);
  if (!amount || a.bonus.some((b) => b.reason === label)) return { t, amount: 0 };
  const next: CbAllowance = { day: a.day, used: a.used, bought: a.bought, bonus: [...a.bonus, { at: t.clock, reason: label, amount }], log: [{ at: t.clock, amount, reason: `Bonus: ${label}`, thread: null }, ...a.log].slice(0, 60) };
  return { t: { ...t, growth: { ...t.growth, cb: { ...t.growth.cb, [persona]: next } } }, amount };
}

export function buyCb(t: TenantState, persona: string): TenantState {
  const p = t.pack.growth.assistant.daily.pack;
  const a = cbAllowance(t, persona);
  const next: CbAllowance = { day: a.day, used: a.used, bonus: a.bonus, bought: a.bought + p.credits, log: [{ at: t.clock, amount: p.credits, reason: `Bought ${p.credits} CB credits`, thread: null }, ...a.log].slice(0, 60) };
  return { ...t, growth: { ...t.growth, cb: { ...t.growth.cb, [persona]: next } } };
}

// ------------------------------------------------------------------ autonomy

export const AUTONOMY_LABEL: Record<Autonomy, string> = { suggest: "Suggest", draft: "Draft", execute: "Execute with approval", auto: "Auto within budget" };
export const WORKFLOW_LABEL: Record<Workflow, string> = { grants: "Credit grants", offers: "Offers", experiments: "Experiments", dunning: "Dunning rescue" };

export function autoBudgetLeft(t: TenantState): number {
  const day = dayOf(t.clock);
  const used = t.growth.autoSpend.day === day ? t.growth.autoSpend.grants : 0;
  return Math.max(0, t.pack.growth.assistant.autoGrantBudget - used);
}

// ------------------------------------------------------------------ the daily step

/** Run once per simulated day (the time machine and the Brain clock both call it through advanceDay). */
export function stepGrowth(t: TenantState): TenantState {
  if (!t.growth) return t;
  const price = entryPrice(t.pack);
  const r = stepLab(t.growth.lab, t.clock, price);
  let g: GrowthState = { ...t.growth, lab: r.experiments };
  for (const e of r.events) {
    if (e.kind === "stop-loss") {
      g = audit(g, { ts: t.clock, actor: "system:stop-loss", workflow: "experiments", what: e.text, decision: "recorded", thread: null, message: null, diff: [{ path: `experiments.${e.id}.status`, before: "running", after: "paused" }] }).g;
      g = track(g, { ts: new Date().toISOString(), sim: null, session: "lab", persona: "system", kind: "experiment", name: "stop-loss", detail: e.text });
    }
  }
  const day = dayOf(t.clock);
  if (g.hypotheses.day !== day) g = { ...g, hypotheses: { day, picked: null, launched: null, history: [{ day: g.hypotheses.day, ids: [], picked: g.hypotheses.picked, launched: g.hypotheses.launched }, ...g.hypotheses.history].slice(0, 30) } };
  return { ...t, growth: g };
}

export const guardrailsDefault = () => GUARDRAILS.map((x) => ({ ...x }));
