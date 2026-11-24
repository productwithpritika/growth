// Where experiments come from: the Experiment Suggestor's plays (§5.6) and the daily hypothesis
// engine (§5.3). Both read the population and turn into an ExperimentSpec the builder can edit.
import type { TenantState } from "@/core/types";
import type { TenantPack } from "@/tenants/schema";
import type { Confidence, ExperimentSpec, Hypothesis, InterventionType } from "@/growth/types";
import { GUARDRAILS } from "@/growth/lab";
import { entryPrice, growthSim, scaleOf, segmentById, segments, thrivingBehaviours, type Segment } from "@/growth/population";
import { fmtNum, fmtPct, fmtUsd } from "@/core/format";
import { fnv1a, mulberry32 } from "@/core/time";
import { primaryMeter } from "@/core/pack";

type Ctx = Pick<TenantState, "pack" | "population" | "clock"> & { growth?: { anchor: string } };

export const METRIC_BASE: Record<string, number> = {
  "Paid within 14 days": 0.05,
  "Ran a second table within 7 days": 0.18,
  "Bought a top-up": 0.08,
  "Renewed next cycle": 0.82,
  "Kept the subscription": 0.35,
  "Upgraded to annual": 0.06,
  "Came back within 14 days": 0.12,
  "Margin per credit": 0.5,
};

export interface Play {
  id: string;
  title: string;
  pitch: string;
  type: InterventionType;
  variant: string;
  layer: string;
  audience: string;
  metric: string;
  prior: [number, number];
  guard: Partial<Record<"refunds" | "tickets" | "margin" | "complaints", number>>;
  basis: (t: Ctx) => string;
  needsEvals?: boolean;
  effort: "S" | "M" | "L";
}

const pct = (x: number) => `${Math.round(x * 100)}%`;

export function plays(pack: TenantPack): Play[] {
  const prim = primaryMeter(pack);
  const spark = pack.hub.spark;
  const starter = pack.hub.starterPack;
  return [
    {
      id: "daily-spark",
      title: "Daily Spark for activated free users",
      pitch: `${spark.amount} ${prim.label} a day after a qualifying run, capped at ${spark.monthlyCap} a month, expiring in ${spark.expiryDays} days.`,
      type: "reward-rule",
      variant: `Daily Spark on: ${spark.amount} ${prim.label} after a qualifying run`,
      layer: "lifecycle",
      audience: "free-activated",
      metric: "Ran a second table within 7 days",
      prior: [0.06, 0.16],
      guard: {},
      effort: "S",
      basis: (t) => {
        const b = thrivingBehaviours(growthSim(t), t.pack, "switchers").find((x) => x.key === "scheduled");
        return b ? `Workspaces with scheduled tables retain ${b.effectPts} points better at week 4; a daily habit is the lever.` : "Habit-forming daily grants raise second-run rates.";
      },
    },
    {
      id: "estimator-first",
      title: "Estimator-first run",
      pitch: "Show the cost estimate and a 10-row preview before the first full run.",
      type: "estimator-default",
      variant: "Estimate and 10-row preview before the first full run",
      layer: "paywall",
      audience: "new-signups",
      metric: "Ran a second table within 7 days",
      prior: [0.04, 0.12],
      guard: {},
      effort: "S",
      basis: (t) => `${fmtPct(segmentById(t, "free-quiet")?.size ? (segmentById(t, "free-quiet")!.size / Math.max(1, growthSim(t).workspaces.length)) : 0)} of all workspaces signed up and never got past a first run.`,
    },
    {
      id: "starter-pack",
      title: "Starter pack at the limit",
      pitch: starter ? `${fmtNum(starter.units)} ${prim.label} for ${fmtUsd(starter.price)} offered the moment a Free run hits the cap.` : "A small pack offered at the cap instead of the upgrade wall.",
      type: "offer",
      variant: starter ? `Starter pack ${fmtNum(starter.units)} for ${fmtUsd(starter.price)} at the limit` : "Starter pack at the limit",
      layer: "paywall",
      audience: "free-blocked",
      metric: "Paid within 14 days",
      prior: [0.1, 0.3],
      guard: { refunds: 0.2 },
      effort: "S",
      basis: (t) => `${fmtNum(segmentById(t, "free-blocked")?.size ?? 0)} free workspaces hit the cap and went quiet instead of upgrading.`,
    },
    {
      id: "autotopup-default",
      title: "Auto top-up on by default at purchase",
      pitch: "Pre-tick auto top-up (with consent and a monthly cap) when someone buys their first pack.",
      type: "packaging",
      variant: "Auto top-up pre-ticked at first purchase, cap shown",
      layer: "billing",
      audience: "paid-all",
      metric: "Bought a top-up",
      prior: [0.05, 0.15],
      guard: { complaints: 0.4 },
      effort: "S",
      basis: (t) => `${fmtPct(growthSim(t).totals.topUpBuyers / Math.max(1, growthSim(t).totals.paid))} of paid workspaces bought a top-up in 90 days.`,
    },
    {
      id: "rollover-wording",
      title: "Rollover wording at 15% versus 25%",
      pitch: "Tell paid users how much rolls over, framed as 'up to 25% carries over' against the 15% control.",
      type: "nudge-copy",
      variant: "Up to 25% of unused credits carry over",
      layer: "pricing",
      audience: "paid-all",
      metric: "Renewed next cycle",
      prior: [0.005, 0.02],
      guard: { margin: -0.5 },
      effort: "S",
      basis: () => "Rollover clarity reduces end-of-cycle anxiety; the cost is breakage you recognise less of.",
    },
    {
      id: "midrun-offer",
      title: "Mid-run exhaustion offer variants",
      pitch: "When a run pauses mid-table: 'Finish these rows for $4' against the upgrade wall.",
      type: "offer",
      variant: "Finish the remaining rows with a right-sized pack",
      layer: "paywall",
      audience: "free-blocked",
      metric: "Paid within 14 days",
      prior: [0.08, 0.25],
      guard: {},
      effort: "M",
      basis: () => "Paused runs carry the highest intent of any moment: the user was mid-task.",
    },
    {
      id: "own-key",
      title: "Own-key nudge",
      pitch: "Suggest adding an own API key for email steps to heavy paid users.",
      type: "nudge-copy",
      variant: "Add your own key for email steps and save Data Credits",
      layer: "pricing",
      audience: "paid-default",
      metric: "Renewed next cycle",
      prior: [0.01, 0.04],
      guard: { margin: -1 },
      effort: "S",
      basis: (t) => `${fmtNum(segmentById(t, "paid-default")?.size ?? 0)} paid workspaces never left the default model.`,
    },
    {
      id: "cheaper-model",
      title: "Cheaper default model",
      pitch: "Default AI research to the cheaper model when an eval shows equal quality.",
      type: "estimator-default",
      variant: "AI research defaults to the cheaper model",
      layer: "pricing",
      audience: "paid-default",
      metric: "Renewed next cycle",
      prior: [0, 0.03],
      guard: { margin: 4 },
      effort: "M",
      needsEvals: true,
      basis: (t) => `${pct(growthSim(t).totals.defaultModelShare)} of model-choice runs stay on the costliest default.`,
    },
    {
      id: "annual-day25",
      title: "Annual upgrade at day 25",
      pitch: `Offer annual billing with ${pack.hub.annualDiscountPct}% off on day 25 of a cycle.`,
      type: "offer",
      variant: `Annual at ${pack.hub.annualDiscountPct}% off on day 25`,
      layer: "pricing",
      audience: "paid-all",
      metric: "Upgraded to annual",
      prior: [0.1, 0.35],
      guard: { margin: -1 },
      effort: "S",
      basis: () => "Day 25 is when users see the renewal coming and compare.",
    },
    {
      id: "winback-expiring",
      title: "Win-back showing expiring credits",
      pitch: "Remind quiet paid users of the credits they will lose, with one suggested table.",
      type: "nudge-copy",
      variant: "Your credits expire on the 1st: here is one table to run",
      layer: "retention",
      audience: "quiet-credits",
      metric: "Came back within 14 days",
      prior: [0.1, 0.3],
      guard: {},
      effort: "S",
      basis: (t) => `${fmtNum(segmentById(t, "quiet-credits")?.size ?? 0)} paid workspaces are idle or quiet with credits that will expire.`,
    },
    {
      id: "cancel-save",
      title: "Matched cancel-save offer",
      pitch: "Match the save offer to the cancel reason: pause for 'not using it', a cheaper plan for 'too expensive'.",
      type: "cancel-save",
      variant: "Offer matched to the stated reason",
      layer: "retention",
      audience: "cancel-intent",
      metric: "Kept the subscription",
      prior: [0.08, 0.25],
      guard: { margin: -2 },
      effort: "M",
      basis: () => "Generic discounts save fewer accounts and cost more margin than matched offers.",
    },
    {
      id: "card-nudge",
      title: "Pre-expiry card nudge",
      pitch: "Ask for a new card 30 days before it expires, with a one-tap update link.",
      type: "nudge-copy",
      variant: "Your card expires before renewal: update in one tap",
      layer: "billing",
      audience: "card-expiring",
      metric: "Renewed next cycle",
      prior: [0.02, 0.06],
      guard: {},
      effort: "S",
      basis: () => "Involuntary churn starts with cards that expire unnoticed.",
    },
  ];
}

export function priorRevenue(t: Ctx, play: Pick<Play, "audience" | "metric" | "prior">): [number, number] {
  const size = segmentById(t, play.audience)?.size ?? 0;
  const price = entryPrice(t.pack);
  const base = METRIC_BASE[play.metric] ?? 0.05;
  return [Math.round(size * base * play.prior[0] * price), Math.round(size * base * play.prior[1] * price)];
}

function audienceOf(t: Ctx, id: string): { id: string; label: string; size: number } {
  const s: Segment | null = segmentById(t, id);
  return { id, label: s?.label ?? id, size: s?.size ?? 0 };
}

const defaultGuards = () => GUARDRAILS.map((g) => ({ ...g }));

export function specFromPlay(t: Ctx, p: Play, origin: ExperimentSpec["origin"] = "play"): ExperimentSpec {
  const base = METRIC_BASE[p.metric] ?? 0.05;
  return {
    name: p.title,
    hypothesis: `If we ${p.pitch.charAt(0).toLowerCase()}${p.pitch.slice(1).replace(/\.$/, "")}, then "${p.metric.toLowerCase()}" rises by ${pct(p.prior[0])}–${pct(p.prior[1])}.`,
    intervention: { type: p.type, detail: p.pitch, variant: p.variant },
    audience: audienceOf(t, p.audience),
    allocation: 0.8,
    holdout: 0.05,
    metric: p.metric,
    metrics: [p.metric, "Bought a top-up", "Margin per credit"].filter((x, i, a) => a.indexOf(x) === i),
    baseRate: base,
    mde: Math.max(0.05, Math.round(((p.prior[0] + p.prior[1]) / 2) * 100) / 100),
    layer: p.layer,
    guardrails: defaultGuards(),
    origin,
    sourceId: p.id,
    newCustomersOnly: false,
    patches: [],
    prior: p.prior,
  };
}

// ------------------------------------------------------------------ hypotheses

interface HypTemplate {
  id: string;
  play: string;
  audience: string;
  observation: (t: Ctx) => string;
  hypothesis: string;
  effort: "S" | "M" | "L";
  risk: "low" | "medium" | "high";
  confidence: Confidence;
  cards: string[];
  title: string;
}

const TEMPLATES: HypTemplate[] = [
  {
    id: "h-spark",
    play: "daily-spark",
    audience: "free-quiet",
    title: "Reward the first enrichment with Daily Spark",
    observation: (t) => {
      const s = segmentById(t, "free-quiet");
      return s ? `${fmtNum(s.size)} free workspaces went quiet before a first enrichment. ${s.drivers[0]}; ${s.drivers[1].toLowerCase()}.` : "Free users go quiet before their first enrichment.";
    },
    hypothesis: "If quiet free users get Daily Spark credits for their first qualifying run, more will run a second table within 7 days.",
    effort: "S",
    risk: "low",
    confidence: "medium",
    cards: ["behaviour-quiet", "behaviour-never"],
  },
  {
    id: "h-estimator",
    play: "estimator-first",
    audience: "free-quiet",
    title: "Show the cost before the first run",
    observation: (t) => `Users who never ran a table cite fear of spending the free allowance; ${segmentById(t, "free-quiet")?.drivers[2] ?? "signups are spread across sources"}.`,
    hypothesis: "If the first run starts with an estimate and a 10-row preview, more quiet users will complete a first run.",
    effort: "S",
    risk: "low",
    confidence: "medium",
    cards: ["behaviour-never", "features-split"],
  },
  {
    id: "h-template",
    play: "estimator-first",
    audience: "free-quiet",
    title: "Nudge a starter template on day 2",
    observation: (t) => {
      const b = thrivingBehaviours(growthSim(t), t.pack, "referral-active").find((x) => x.key === "template");
      return b ? `Referral workspaces start from a template ${fmtPct(b.inSegment)} of the time against ${fmtPct(b.baseline)} overall, and retain better.` : "Template users retain better.";
    },
    hypothesis: "If quiet users get a day-2 nudge to open a ready-made table, more will run their first enrichment.",
    effort: "S",
    risk: "low",
    confidence: "low",
    cards: ["customers-sources"],
  },
  {
    id: "h-starter",
    play: "starter-pack",
    audience: "free-blocked",
    title: "Offer a starter pack at the cap",
    observation: (t) => `${fmtNum(segmentById(t, "free-blocked")?.size ?? 0)} free workspaces hit the cap and went quiet. ${segmentById(t, "free-blocked")?.drivers[1] ?? ""}.`,
    hypothesis: "If capped free users can buy a small pack at the limit, paid conversion within 14 days rises without pulling plan revenue down.",
    effort: "S",
    risk: "low",
    confidence: "high",
    cards: ["pricing-topups"],
  },
  {
    id: "h-model",
    play: "cheaper-model",
    audience: "paid-default",
    title: "Default AI research to the cheaper model",
    observation: (t) => `${pct(growthSim(t).totals.defaultModelShare)} of model-choice runs stay on the costliest default.`,
    hypothesis: "If AI research defaults to the cheaper model, margin per credit rises with no drop in renewals.",
    effort: "M",
    risk: "medium",
    confidence: "medium",
    cards: ["models-default"],
  },
  {
    id: "h-winback",
    play: "winback-expiring",
    audience: "quiet-credits",
    title: "Win back quiet paid users with their expiring credits",
    observation: (t) => `${fmtNum(segmentById(t, "quiet-credits")?.size ?? 0)} paid workspaces are idle or quiet with credits that will expire.`,
    hypothesis: "If quiet paid users see the credits they are about to lose with one suggested table, more come back within 14 days.",
    effort: "S",
    risk: "low",
    confidence: "medium",
    cards: ["behaviour-churn3"],
  },
  {
    id: "h-cancel",
    play: "cancel-save",
    audience: "cancel-intent",
    title: "Match the save offer to the cancel reason",
    observation: (t) => `${fmtNum(growthSim(t).chats.filter((c) => c.intent === "discount" || c.intent === "free-credits").length * scaleOf(t.pack))} help-chat requests for discounts or free credits in 90 days.`,
    hypothesis: "If the save offer matches the stated reason, more cancelling users keep the subscription at a lower margin cost than a blanket discount.",
    effort: "M",
    risk: "medium",
    confidence: "medium",
    cards: ["helpchat-clusters"],
  },
  {
    id: "h-annual",
    play: "annual-day25",
    audience: "paid-topup",
    title: "Offer annual billing to top-up buyers on day 25",
    observation: (t) => `Top-up buyers retain best: ${segmentById(t, "paid-topup")?.drivers[0] ?? ""}.`,
    hypothesis: "If committed paid users get an annual offer on day 25, more lock in for a year.",
    effort: "S",
    risk: "low",
    confidence: "medium",
    cards: ["behaviour-topups"],
  },
];

const CONF_W: Record<Confidence, number> = { high: 1, medium: 0.75, low: 0.5 };
const EFFORT_W = { S: 1, M: 1.6, L: 2.5 } as const;

function toHypothesis(t: Ctx, tpl: HypTemplate, day: string, jitter = 1): Hypothesis {
  const p = plays(t.pack).find((x) => x.id === tpl.play)!;
  const audience = audienceOf(t, tpl.audience);
  const base = METRIC_BASE[p.metric] ?? 0.05;
  const [lo, hi] = priorRevenue(t, { audience: tpl.audience, metric: p.metric, prior: p.prior });
  const ev = ((lo + hi) / 2) * CONF_W[tpl.confidence];
  const score = Math.round((ev / EFFORT_W[tpl.effort]) * jitter);
  return {
    id: `${tpl.id}`,
    day,
    observation: tpl.observation(t),
    hypothesis: tpl.hypothesis,
    effect: p.prior,
    metric: p.metric,
    audience,
    intervention: { type: p.type, detail: p.pitch, variant: p.variant },
    guardrails: GUARDRAILS.map((g) => g.label),
    effort: tpl.effort,
    risk: tpl.risk,
    confidence: tpl.confidence,
    layer: p.layer,
    baseRate: base,
    score,
    why: `${fmtUsd(lo, 0)}–${fmtUsd(hi, 0)} a month on the prior, ${tpl.risk} risk, effort ${tpl.effort}, ${tpl.confidence} confidence.`,
    cards: tpl.cards,
  };
}

export function hypothesisTitle(id: string): string {
  return TEMPLATES.find((x) => x.id === id)?.title ?? id;
}

/** Ids of hypotheses already being tested, so the daily three move on to new ideas. */
export function inFlightSources(lab: { sourceId: string | null; status: string }[]): string[] {
  return lab.filter((e) => e.sourceId && ["approved", "running", "paused", "readout"].includes(e.status)).map((e) => e.sourceId!);
}

/** Today's three, ranked: the best idea not already in flight, then two more from other audiences, rotating with the day. */
export function dailyHypotheses(t: Ctx, day: string, exclude: string[] = []): Hypothesis[] {
  const r = mulberry32(parseInt(fnv1a(`hyp:${t.pack.id}:${day}`), 16));
  const all = TEMPLATES.filter((x) => !exclude.includes(x.id)).map((tpl) => toHypothesis(t, tpl, day));
  all.sort((a, b) => b.score - a.score);
  if (!all.length) return [];
  const rest = all.slice(1).map((h) => ({ h, j: h.score * (0.6 + 0.8 * r()) })).sort((a, b) => b.j - a.j).map((x) => x.h);
  const out = [all[0]];
  for (const h of rest) if (out.length < 3 && !out.some((y) => y.audience.id === h.audience.id)) out.push(h);
  for (const h of rest) if (out.length < 3 && !out.includes(h)) out.push(h);
  return rank(out);
}

/** The three hypotheses for one audience (the tour asks why the at-risk free cohort leaves). */
export function hypothesesFor(t: Ctx, audience: string, day: string): Hypothesis[] {
  const xs = TEMPLATES.filter((x) => x.audience === audience).map((tpl) => toHypothesis(t, tpl, day));
  xs.sort((a, b) => b.score - a.score);
  return rank(xs.slice(0, 3));
}

function rank(xs: Hypothesis[]): Hypothesis[] {
  if (!xs.length) return xs;
  const best = xs[0];
  return xs.map((h, i) => (i === 0 ? { ...h, why: `Recommended: the highest expected value for the effort. ${best.why}` } : h));
}

export function specFromHypothesis(t: Ctx, h: Hypothesis, origin: ExperimentSpec["origin"] = "hypothesis"): ExperimentSpec {
  const tpl = TEMPLATES.find((x) => x.id === h.id);
  const p = plays(t.pack).find((x) => x.id === tpl?.play) ?? plays(t.pack)[0];
  const spec = specFromPlay(t, p, origin);
  return {
    ...spec,
    name: tpl?.title ?? h.hypothesis.slice(0, 60),
    hypothesis: h.hypothesis,
    audience: h.audience,
    intervention: h.intervention,
    sourceId: h.id,
  };
}

export function allSegments(t: Ctx) {
  return segments(t);
}
