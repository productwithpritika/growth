// Experiment builder and runner (Phase 5 §5.4–5.5). An experiment is a spec plus a hidden "truth"
// drawn from its prior; each simulated day the runner exposes users and draws outcomes for control
// and variant from that truth, checks guardrails (stop-loss) and the sample ratio, and at day 7
// moves to a decision-grade read-out. Nothing declares a winner before day 7.
import type { TenantPack } from "@/tenants/schema";
import type { ArmDay, ExperimentSpec, Guardrail, LabDay, LabExperiment, PackPatch, Verdict } from "@/growth/types";
import { addDays, fnv1a, mulberry32, normal } from "@/core/time";

export const GUARDRAILS: Guardrail[] = [
  { id: "refunds", label: "Refund rate", maxWorsePts: 2 },
  { id: "tickets", label: "Support tickets per 100 users", maxWorsePts: 2.5 },
  { id: "margin", label: "Gross margin", maxWorsePts: 3 },
  { id: "complaints", label: "Complaint rate", maxWorsePts: 0.6 },
];

export const LAYERS: { id: string; label: string; covers: string }[] = [
  { id: "paywall", label: "Paywall and limit moments", covers: "what a user sees when a cap or balance stops a run" },
  { id: "lifecycle", label: "Lifecycle and rewards", covers: "nudges, Daily Spark, badges and onboarding" },
  { id: "pricing", label: "Pricing and packaging", covers: "plans, pack prices, rollover, model defaults" },
  { id: "retention", label: "Retention and win-back", covers: "cancel-save offers and win-back" },
  { id: "billing", label: "Billing and payments", covers: "auto top-up defaults, card nudges, dunning" },
];

export const INTERVENTIONS: { id: ExperimentSpec["intervention"]["type"]; label: string; layer: string }[] = [
  { id: "reward-rule", label: "Reward rule", layer: "lifecycle" },
  { id: "nudge-copy", label: "Nudge copy", layer: "lifecycle" },
  { id: "offer", label: "Offer", layer: "paywall" },
  { id: "topup-price", label: "Top-up pack price", layer: "pricing" },
  { id: "packaging", label: "Packaging", layer: "pricing" },
  { id: "cancel-save", label: "Cancel-save offer", layer: "retention" },
  { id: "estimator-default", label: "Estimator default", layer: "paywall" },
  { id: "model-default", label: "Model default for a skill", layer: "pricing" },
];

/** Extra guardrails for experiments that switch the model behind a skill (Phase 6 §6.5). */
export const MODEL_GUARDRAILS: Guardrail[] = [
  { id: "quality", label: "User-reported low quality per 100 runs", maxWorsePts: 1 },
  { id: "rerun", label: "Rerun rate", maxWorsePts: 1.5 },
];

export const METRICS = ["Paid within 14 days", "Ran a second table within 7 days", "Bought a top-up", "Renewed next cycle", "Margin per credit", "Kept the subscription"];

/** Share of the arm's audience first exposed on each day of the first week; a trickle after. */
const RAMP = [0.3, 0.2, 0.15, 0.12, 0.09, 0.08, 0.06];
/** Share of eventual conversions that have happened d days after exposure. */
const LAG = [0.12, 0.28, 0.42, 0.55, 0.67, 0.78, 0.88, 0.95, 1];

const BASE = { engaged: 0.32, intent: 0.11, runsPerDay: 0.34, creditsPerRun: 58, topUp: 0.035, retain: 0.62, refunds: 0.03, tickets: 0.018, complaints: 0.004, margin: 0.68 };

export const z = (p: number) => {
  // Inverse normal CDF (Acklam), enough for 0.8–0.999.
  const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2, -3.066479806614716e1, 2.506628277459239];
  const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1];
  const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416];
  const q = p < 0.5 ? p : 1 - p;
  if (q < 0.02425) {
    const r = Math.sqrt(-2 * Math.log(q));
    const x = (((((c[0] * r + c[1]) * r + c[2]) * r + c[3]) * r + c[4]) * r + c[5]) / ((((d[0] * r + d[1]) * r + d[2]) * r + d[3]) * r + 1);
    return p < 0.5 ? x : -x;
  }
  const r = q - 0.5;
  const s = r * r;
  const x = ((((((a[0] * s + a[1]) * s + a[2]) * s + a[3]) * s + a[4]) * s + a[5]) * r) / (((((b[0] * s + b[1]) * s + b[2]) * s + b[3]) * s + b[4]) * s + 1);
  return p < 0.5 ? x : -x;
};

/** Users needed per arm to detect a relative lift `mde` on a base rate `p` at 95% confidence and 80% power. */
export function sampleSize(p: number, mde: number, alpha = 0.05, power = 0.8): number {
  const p2 = Math.min(0.999, p * (1 + mde));
  const za = Math.abs(z(alpha / 2));
  const zb = Math.abs(z(1 - power));
  const num = (za + zb) ** 2 * (p * (1 - p) + p2 * (1 - p2));
  const den = (p2 - p) ** 2;
  return den > 0 ? Math.ceil(num / den) : Infinity;
}

/** Users each arm will see in the first week. */
export function armSize(spec: Pick<ExperimentSpec, "audience" | "allocation" | "holdout">): number {
  return Math.floor((spec.audience.size * spec.allocation * (1 - spec.holdout)) / 2);
}

export function emptyArm(): ArmDay {
  return { exposed: 0, engaged: 0, intent: 0, runs: 0, burn: 0, topUpStarts: 0, converted: 0, retained: 0, revenue: 0, credits: 0, cost: 0, refunds: 0, tickets: 0, complaints: 0, rerun: 0, lowQuality: 0 };
}

const sum = (days: LabDay[], arm: "control" | "variant", upTo: number): ArmDay => {
  const out = emptyArm();
  for (const d of days) {
    if (d.day > upTo) break;
    const a = d[arm];
    for (const k of Object.keys(out) as (keyof ArmDay)[]) out[k] = (out[k] ?? 0) + (a[k] ?? 0);
  }
  return out;
};

export function totals(e: Pick<LabExperiment, "days">, upTo = Infinity) {
  return { control: sum(e.days, "control", upTo), variant: sum(e.days, "variant", upTo) };
}

/** Deterministic truth for an experiment: the real lift is drawn inside its prior. */
export function drawTruth(id: string, prior: [number, number], guard: LabExperiment["truth"]["guard"] = {}): LabExperiment["truth"] {
  const r = mulberry32(parseInt(fnv1a(`truth:${id}`), 16));
  const u = r();
  return { lift: Math.round((prior[0] + (prior[1] - prior[0]) * u) * 1000) / 1000, guard };
}

export function newExperiment(spec: ExperimentSpec, id: string, owner: string, at: string, guard: LabExperiment["truth"]["guard"] = {}): LabExperiment {
  return {
    ...spec,
    id,
    status: "draft",
    owner,
    createdAt: at,
    approvedAt: null,
    launchedAt: null,
    endedAt: null,
    pausedReason: null,
    days: [],
    truth: drawTruth(spec.sourceId ?? id, spec.prior, guard),
    decision: null,
    thread: null,
  };
}

// ------------------------------------------------------------------ validation and launch checks

export interface LaunchIssue {
  level: "block" | "warn";
  text: string;
}

export function collisions(e: Pick<LabExperiment, "id" | "layer" | "audience">, all: LabExperiment[]): LabExperiment[] {
  return all.filter((x) => x.id !== e.id && x.layer === e.layer && (x.status === "running" || x.status === "approved" || x.status === "paused") && x.audience.id === e.audience.id);
}

export function launchIssues(e: LabExperiment, all: LabExperiment[], pack: TenantPack, extra: LaunchIssue[] = []): LaunchIssue[] {
  const out: LaunchIssue[] = [...extra];
  const hold = pack.growth.holdout;
  if (e.holdout < hold.min || e.holdout > hold.max) out.push({ level: "block", text: `Holdout must be between ${Math.round(hold.min * 100)}% and ${Math.round(hold.max * 100)}% of the audience.` });
  if (!e.guardrails.length) out.push({ level: "block", text: "Add at least one guardrail. Refunds, support tickets, gross margin and complaints are always reported." });
  if (!e.metrics.includes(e.metric)) out.push({ level: "block", text: "Pre-register the primary metric before launch." });
  const clash = collisions(e, all);
  for (const c of clash) out.push({ level: "block", text: `Collides with "${c.name}" in the ${LAYERS.find((l) => l.id === e.layer)?.label.toLowerCase() ?? e.layer} layer for the same audience. Pick another layer or wait until it ends.` });
  const need = sampleSize(e.baseRate, e.mde);
  const have = armSize(e);
  if (have < need) out.push({ level: "warn", text: `Under-powered: detecting a ${Math.round(e.mde * 100)}% lift needs ${need.toLocaleString("en-US")} users per arm; this audience gives ${have.toLocaleString("en-US")} in a week. Read the D7 result as directional or widen the audience.` });
  if (e.audience.size < 50) out.push({ level: "block", text: "The audience is too small to split. Save a larger audience first." });
  return out;
}

// ------------------------------------------------------------------ the daily runner

function noisy(r: () => number, expected: number): number {
  if (expected <= 0) return 0;
  return Math.max(0, Math.round(expected + normal(r) * Math.sqrt(expected)));
}

function exposures(e: LabExperiment, day: number): number {
  const n = armSize(e) * 2;
  const share = day <= RAMP.length ? RAMP[day - 1] : 0.02;
  return Math.round(n * share);
}

/** Simulate day `day` (1-based) of an experiment. Pure: the same experiment and day give the same numbers. */
export function simulateDay(e: LabExperiment, day: number, date: string, price: number): LabDay {
  const r = mulberry32(parseInt(fnv1a(`${e.sourceId ?? e.id}:${e.audience.size}:${day}`), 16));
  const total = exposures(e, day);
  const control = Math.max(0, Math.round(total / 2 + (normal(r) * Math.sqrt(Math.max(total, 1))) / 2));
  const variant = Math.max(0, total - control);
  const L = e.truth.lift;
  const g = e.truth.guard;
  const prior = e.days;
  const arm = (k: "control" | "variant", newly: number): ArmDay => {
    const v = k === "variant";
    const m = (x: number, s = 1) => (v ? x * (1 + s * L) : x);
    const cum = prior.reduce((s, d) => s + d[k].exposed, 0) + newly;
    // Conversions owed today: every earlier day's exposures move one step further along the lag curve.
    const byDay = [...prior.map((d) => d[k].exposed), newly];
    let owed = 0;
    for (let j = 0; j < byDay.length; j++) {
      const age = byDay.length - 1 - j;
      const now = LAG[Math.min(age, LAG.length - 1)];
      const before = age === 0 ? 0 : LAG[Math.min(age - 1, LAG.length - 1)];
      owed += byDay[j] * (now - before);
    }
    const retainOwed = byDay.length > 3 ? byDay[byDay.length - 4] : 0;
    const converted = noisy(r, owed * m(e.baseRate));
    const runs = noisy(r, cum * m(BASE.runsPerDay, 0.8));
    const burn = Math.round(runs * BASE.creditsPerRun * (1 + 0.05 * normal(r)));
    const topUpStarts = noisy(r, newly * m(BASE.topUp, 1));
    const revenue = converted * price * (v && e.intervention.type === "offer" ? 0.85 : 1) + topUpStarts * price * 0.12;
    const margin = BASE.margin + (v ? (g.margin ?? 0) / 100 : 0) + 0.004 * normal(r);
    const model = e.skill ? { rerun: noisy(r, runs * 0.06 * (1 + (v ? (g.rerun ?? 0) : 0))), lowQuality: noisy(r, runs * 0.02 * (1 + (v ? (g.quality ?? 0) : 0))) } : {};
    return {
      ...model,
      exposed: newly,
      engaged: noisy(r, newly * m(BASE.engaged, 1.4)),
      intent: noisy(r, newly * m(BASE.intent, 1.2)),
      runs,
      burn,
      topUpStarts,
      converted,
      retained: noisy(r, retainOwed * m(BASE.retain, 0.4)),
      revenue: Math.round(revenue * 100) / 100,
      credits: burn,
      cost: Math.round(revenue * (1 - margin) * 100) / 100,
      refunds: noisy(r, converted * BASE.refunds * (1 + (v ? (g.refunds ?? 0) : 0))),
      tickets: noisy(r, newly * BASE.tickets * (1 + (v ? (g.tickets ?? 0) : 0))),
      complaints: noisy(r, newly * BASE.complaints * (1 + (v ? (g.complaints ?? 0) : 0))),
    };
  };
  return { day, date, control: arm("control", control), variant: arm("variant", variant) };
}

// ------------------------------------------------------------------ statistics

export interface Interval {
  control: number;
  variant: number;
  /** Absolute difference variant − control, with a 95% interval. */
  diff: number;
  lo: number;
  hi: number;
  /** Relative lift and its interval, when the control rate is above zero. */
  lift: number;
  liftLo: number;
  liftHi: number;
}

export function propInterval(c: { n: number; x: number }, v: { n: number; x: number }): Interval {
  const p1 = c.n ? c.x / c.n : 0;
  const p2 = v.n ? v.x / v.n : 0;
  const se = Math.sqrt((c.n ? (p1 * (1 - p1)) / c.n : 0) + (v.n ? (p2 * (1 - p2)) / v.n : 0));
  const diff = p2 - p1;
  const lo = diff - 1.96 * se;
  const hi = diff + 1.96 * se;
  return { control: p1, variant: p2, diff, lo, hi, lift: p1 > 0 ? diff / p1 : 0, liftLo: p1 > 0 ? lo / p1 : 0, liftHi: p1 > 0 ? hi / p1 : 0 };
}

/** Per-user totals (runs, credits, revenue): Poisson-style interval on the difference of means. */
export function meanInterval(c: { n: number; s: number }, v: { n: number; s: number }, spread = 1.6): Interval {
  const m1 = c.n ? c.s / c.n : 0;
  const m2 = v.n ? v.s / v.n : 0;
  const se = Math.sqrt((c.n ? (spread * Math.max(m1, 1e-6) * Math.max(c.s, 1)) / (c.n * c.n) : 0) + (v.n ? (spread * Math.max(m2, 1e-6) * Math.max(v.s, 1)) / (v.n * v.n) : 0));
  const diff = m2 - m1;
  return { control: m1, variant: m2, diff, lo: diff - 1.96 * se, hi: diff + 1.96 * se, lift: m1 > 0 ? diff / m1 : 0, liftLo: m1 > 0 ? (diff - 1.96 * se) / m1 : 0, liftHi: m1 > 0 ? (diff + 1.96 * se) / m1 : 0 };
}

function erf(x: number): number {
  const s = Math.sign(x);
  const ax = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * ax);
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-ax * ax);
  return s * y;
}

/** Sample-ratio check: chi-square on the control/variant split against the planned 50/50. */
export function srm(e: Pick<LabExperiment, "days">): { p: number; ok: boolean; control: number; variant: number } {
  const t = totals(e);
  const c = t.control.exposed;
  const v = t.variant.exposed;
  if (c + v === 0) return { p: 1, ok: true, control: 0, variant: 0 };
  const chi = (c - v) ** 2 / (c + v);
  const p = 1 - erf(Math.sqrt(chi / 2));
  return { p, ok: p >= 0.001, control: c, variant: v };
}

export interface GuardReading {
  id: Guardrail["id"];
  label: string;
  control: number;
  variant: number;
  unit: string;
  worsePts: number;
  limit: number;
  breached: boolean;
}

/** Guardrails at a checkpoint. A breach needs enough data, a gap beyond the limit, and (for counts) a gap the noise cannot explain. */
export function guardReadings(e: Pick<LabExperiment, "days" | "guardrails">, upTo = Infinity): GuardReading[] {
  const t = totals(e, upTo);
  const c = t.control;
  const v = t.variant;
  const out: GuardReading[] = [];
  for (const g of MODEL_GUARDRAILS) {
    const own = e.guardrails.find((x) => x.id === g.id);
    if (!own) continue;
    const key = g.id === "quality" ? "lowQuality" : "rerun";
    const xc = c[key] ?? 0;
    const xv = v[key] ?? 0;
    const rc = c.runs ? (xc / c.runs) * 100 : 0;
    const rv = v.runs ? (xv / v.runs) * 100 : 0;
    const p = (xc + xv) / Math.max(1, c.runs + v.runs);
    const se = Math.sqrt(p * (1 - p) * (1 / Math.max(1, c.runs) + 1 / Math.max(1, v.runs))) * 100;
    out.push({ id: g.id, label: g.label, control: rc, variant: rv, unit: g.id === "quality" ? "per 100 runs" : "%", worsePts: rv - rc, limit: own.maxWorsePts, breached: c.runs >= 500 && v.runs >= 500 && rv - rc > own.maxWorsePts && rv - rc > 3 * se });
  }
  for (const g of GUARDRAILS) {
    const limit = e.guardrails.find((x) => x.id === g.id)?.maxWorsePts ?? g.maxWorsePts;
    if (g.id === "margin") {
      const mc = c.revenue > 0 ? (1 - c.cost / c.revenue) * 100 : 0;
      const mv = v.revenue > 0 ? (1 - v.cost / v.revenue) * 100 : 0;
      const worse = mc - mv;
      out.push({ id: g.id, label: g.label, control: mc, variant: mv, unit: "%", worsePts: worse, limit, breached: c.converted >= 5 && v.converted >= 5 && worse > limit });
      continue;
    }
    const base = g.id === "refunds" ? { c: c.converted, v: v.converted } : { c: c.exposed, v: v.exposed };
    const k = g.id as "refunds" | "tickets" | "complaints";
    const xc = c[k] ?? 0;
    const xv = v[k] ?? 0;
    const rc = base.c ? (xc / base.c) * 100 : 0;
    const rv = base.v ? (xv / base.v) * 100 : 0;
    const p = (xc + xv) / Math.max(1, base.c + base.v);
    const se = Math.sqrt(p * (1 - p) * (1 / Math.max(1, base.c) + 1 / Math.max(1, base.v))) * 100;
    const worse = rv - rc;
    const enough = g.id === "refunds" ? base.c >= 30 && base.v >= 30 : base.c >= 200 && base.v >= 200;
    out.push({ id: g.id, label: g.label, control: rc, variant: rv, unit: g.id === "tickets" ? "per 100" : "%", worsePts: worse, limit, breached: enough && worse > limit && worse > 3 * se });
  }
  return out;
}

// ------------------------------------------------------------------ scorecard

export type Checkpoint = 1 | 3 | 7;
export const CHECKPOINTS: Checkpoint[] = [1, 3, 7];

export interface ScoreLine {
  id: string;
  label: string;
  kind: "rate" | "mean" | "count" | "usd";
  at: Partial<Record<Checkpoint, Interval>>;
}

export interface Scorecard {
  daysRun: number;
  verdict: Verdict;
  leading: ScoreLine[];
  directional: ScoreLine[];
  decision: ScoreLine[];
  guards: Partial<Record<Checkpoint, GuardReading[]>>;
  srm: ReturnType<typeof srm>;
  segments: { label: string; lift: number; lo: number; hi: number; n: number }[];
  reason: string;
}

export function daysRun(e: Pick<LabExperiment, "days">): number {
  return e.days.length;
}

function lineAt(e: LabExperiment, d: Checkpoint, f: (a: ArmDay) => { n: number; x?: number; s?: number }): Interval | undefined {
  if (daysRun(e) < d) return undefined;
  const t = totals(e, d);
  const c = f(t.control);
  const v = f(t.variant);
  return c.x != null ? propInterval({ n: c.n, x: c.x }, { n: v.n, x: v.x ?? 0 }) : meanInterval({ n: c.n, s: c.s ?? 0 }, { n: v.n, s: v.s ?? 0 });
}

export function verdictOf(e: LabExperiment): { verdict: Verdict; reason: string } {
  const n = daysRun(e);
  if (n < 3) return { verdict: "Too early", reason: n === 0 ? (e.launchedAt ? "Launched today. Day 1 numbers arrive tomorrow: move the Time machine forward." : "Not launched yet.") : "Day 1 shows exposure and engagement only. It never declares a winner." };
  if (n < 7) return { verdict: "Directional", reason: "Day 3 shows behaviour moving. Decisions wait for one full weekly cycle (D7)." };
  const g = guardReadings(e, 7);
  const breach = g.find((x) => x.breached);
  const c = lineAt(e, 7, (a) => ({ n: a.exposed, x: a.converted }))!;
  if (breach) return { verdict: "Kill", reason: `${breach.label} is worse by ${breach.worsePts.toFixed(1)} points, beyond the ${breach.limit}-point guardrail.` };
  if (c.lo > 0) return { verdict: "Ship", reason: `Conversion is up ${(c.lift * 100).toFixed(0)}% and the 95% interval (${(c.liftLo * 100).toFixed(0)}% to ${(c.liftHi * 100).toFixed(0)}%) excludes zero, with guardrails holding.` };
  if (c.hi < 0) return { verdict: "Kill", reason: `Conversion is down ${(Math.abs(c.lift) * 100).toFixed(0)}% and the interval excludes zero.` };
  return { verdict: "Hold", reason: `The interval (${(c.liftLo * 100).toFixed(0)}% to ${(c.liftHi * 100).toFixed(0)}%) still includes zero. Keep running another week or widen the audience.` };
}

export function scorecard(e: LabExperiment): Scorecard {
  const line = (id: string, label: string, kind: ScoreLine["kind"], f: (a: ArmDay) => { n: number; x?: number; s?: number }, from: Checkpoint): ScoreLine => {
    const at: ScoreLine["at"] = {};
    for (const d of CHECKPOINTS) if (d >= from) at[d] = lineAt(e, d, f);
    return { id, label, kind, at };
  };
  const leading = [
    line("exposed", "Exposed users", "count", (a) => ({ n: 1, s: a.exposed }), 1),
    line("engaged", "Engaged with the change", "rate", (a) => ({ n: a.exposed, x: a.engaged }), 1),
    line("intent", "Stated intent (clicked the offer or saved a plan)", "rate", (a) => ({ n: a.exposed, x: a.intent }), 1),
  ];
  const directional = [
    line("runs", "Runs per user", "mean", (a) => ({ n: Math.max(1, a.exposed), s: a.runs }), 3),
    line("burn", "Credit burn per user", "mean", (a) => ({ n: Math.max(1, a.exposed), s: a.burn }), 3),
    line("topups", "Top-up starts", "rate", (a) => ({ n: a.exposed, x: a.topUpStarts }), 3),
  ];
  const decision = [
    line("converted", e.metric, "rate", (a) => ({ n: a.exposed, x: a.converted }), 7),
    line("retained", "Still active after 3 days", "rate", (a) => ({ n: Math.max(1, a.exposed), x: Math.min(a.retained, a.exposed) }), 7),
    line("rpu", "Revenue per user", "usd", (a) => ({ n: Math.max(1, a.exposed), s: a.revenue }), 7),
    line("mpc", "Margin per credit", "usd", (a) => ({ n: Math.max(1, a.credits), s: a.revenue - a.cost }), 7),
  ];
  const guards: Scorecard["guards"] = {};
  for (const d of CHECKPOINTS) if (daysRun(e) >= d) guards[d] = guardReadings(e, d);
  const v = verdictOf(e);
  const segs: Scorecard["segments"] = [];
  if (daysRun(e) >= 7) {
    const t = totals(e, 7);
    for (const [label, share, tilt] of [
      ["United States", 0.55, 1.05],
      ["European Union", 0.3, 0.9],
      ["India", 0.15, 1.1],
    ] as const) {
      const c = { n: Math.round(t.control.exposed * share), x: Math.round(t.control.converted * share) };
      const vv = { n: Math.round(t.variant.exposed * share), x: Math.round(t.variant.converted * share * tilt) };
      const iv = propInterval(c, vv);
      segs.push({ label, lift: iv.lift, lo: iv.liftLo, hi: iv.liftHi, n: c.n + vv.n });
    }
  }
  return { daysRun: daysRun(e), verdict: v.verdict, leading, directional, decision, guards, srm: srm(e), segments: segs, reason: v.reason };
}

// ------------------------------------------------------------------ state transitions

export interface StepResult {
  experiments: LabExperiment[];
  events: { id: string; kind: "stop-loss" | "readout" | "day"; text: string }[];
}

/** Advance every running experiment to `clockIso`: one simulated day per calendar day since launch. */
export function stepLab(list: LabExperiment[], clockIso: string, price: number): StepResult {
  const events: StepResult["events"] = [];
  const clock = new Date(clockIso).getTime();
  const out = list.map((e0) => {
    if (e0.status !== "running" || !e0.launchedAt || e0.sandbox) return e0;
    let e = e0;
    const elapsed = Math.floor((clock - new Date(e.launchedAt!).getTime()) / 86_400_000);
    const target = Math.min(elapsed, 14);
    while (e.days.length < target && e.status === "running") {
      const day = e.days.length + 1;
      const date = addDays(new Date(e.launchedAt!), day).toISOString();
      e = { ...e, days: [...e.days, simulateDay(e, day, date, price)] };
      const breach = guardReadings(e).find((g) => g.breached);
      if (breach) {
        e = { ...e, status: "paused", pausedReason: `Stop-loss on day ${day}: ${breach.label.toLowerCase()} is ${breach.worsePts.toFixed(1)} points worse than control (limit ${breach.limit}).` };
        events.push({ id: e.id, kind: "stop-loss", text: `${e.name} paused automatically: ${breach.label.toLowerCase()} breached its guardrail on day ${day}.` });
      } else if (day === 7 || day === 14) {
        e = { ...e, status: "readout" };
        events.push({ id: e.id, kind: "readout", text: `${e.name} reached its day ${day} read-out.` });
      }
    }
    return e;
  });
  return { experiments: out, events };
}

/** Run an experiment's first `n` days in place (seeding). */
export function preRun(e: LabExperiment, launchedAt: string, n: number, price: number): LabExperiment {
  let x: LabExperiment = { ...e, status: "running", approvedAt: launchedAt, launchedAt };
  const end = addDays(new Date(launchedAt), n).toISOString();
  x = stepLab([x], end, price).experiments[0];
  return x;
}

export function applyPatches(pack: TenantPack, patches: PackPatch[], dir: "after" | "before"): TenantPack {
  const next = JSON.parse(JSON.stringify(pack)) as TenantPack;
  for (const p of patches) setPath(next as unknown as Record<string, unknown>, p.path, dir === "after" ? p.after : p.before);
  return next;
}

export function getPath(obj: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((o, k) => (o == null ? undefined : (o as Record<string, unknown>)[k]), obj);
}

function setPath(obj: Record<string, unknown>, path: string, value: unknown) {
  const keys = path.split(".");
  let node: Record<string, unknown> = obj;
  for (const k of keys.slice(0, -1)) {
    const next = Reflect.get(node, k);
    if (next == null || typeof next !== "object") Reflect.set(node, k, {});
    node = Reflect.get(node, k) as Record<string, unknown>;
  }
  const leaf = keys[keys.length - 1];
  if (value !== undefined) Reflect.set(node, leaf, value);
  else if (Array.isArray(node)) node.splice(Number(leaf), 1);
  else Reflect.deleteProperty(node, leaf);
}

/** A monthly revenue estimate for shipping: audience flow × base rate × lift × price. */
export function monthlyImpact(e: Pick<LabExperiment, "audience" | "baseRate" | "truth" | "days">, price: number, observedLift?: number): number {
  const lift = observedLift ?? e.truth.lift;
  return Math.round(e.audience.size * e.baseRate * lift * price);
}

export const STATUS_LABEL: Record<LabExperiment["status"], string> = {
  draft: "Draft",
  approved: "Approved",
  running: "Running",
  paused: "Paused",
  readout: "Read-out",
  shipped: "Shipped",
  killed: "Killed",
  reverted: "Reverted",
};

export const STATUS_TONE: Record<LabExperiment["status"], "neutral" | "info" | "watch" | "healthy" | "blocked" | "reward"> = {
  draft: "neutral",
  approved: "info",
  running: "info",
  paused: "watch",
  readout: "reward",
  shipped: "healthy",
  killed: "blocked",
  reverted: "neutral",
};
