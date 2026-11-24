// The Growth Workbench reads the 90-day population simulator (Phase 1 §1.6): 2,000 workspaces with
// region, acquisition source, plan, activity and model behaviour. Everything here is derived from
// that output, deterministically, so the same pack and anchor always give the same cohorts.
import type { TenantState } from "@/core/types";
import type { TenantPack } from "@/tenants/schema";
import type { SimOutput, WorkspaceSummary } from "@/sim/usage90-types";
import { simConfigFor, simulateCached } from "@/sim/usage90";
import { fnv1a, mulberry32 } from "@/core/time";
import { freePlan, planOf, primaryMeter } from "@/core/pack";
import { fmtNum, fmtPct, fmtUsd } from "@/core/format";
import { addDays } from "@/core/time";

export function growthSim(t: Pick<TenantState, "pack" | "population" | "clock"> & { growth?: { anchor: string } }): SimOutput {
  const cfg = t.population?.config ?? simConfigFor(t.pack);
  return simulateCached(t.pack, cfg, t.population?.anchor ?? t.growth?.anchor ?? t.clock);
}

export const lastDay = (sim: SimOutput) => sim.config.days - 1;
/** How many real workspaces one simulated workspace stands for. */
export const scaleOf = (pack: TenantPack) => pack.growth?.sampleScale ?? 1;
export const ageDays = (sim: SimOutput, w: WorkspaceSummary) => lastDay(sim) - w.signupDay;
export const isPaid = (pack: TenantPack, w: WorkspaceSummary) => planOf(pack, w.planId).paid;

// ------------------------------------------------------------------ behaviours

export interface Behaviours {
  scheduled: boolean;
  waterfall: boolean;
  ownKey: boolean;
  crm: boolean;
  template: boolean;
}

export const BEHAVIOUR_LABELS: Record<keyof Behaviours, string> = {
  scheduled: "Scheduled tables",
  waterfall: "Uses a waterfall",
  ownKey: "Own API key added",
  crm: "CRM sync on",
  template: "Started from a template",
};

const STATUS_ACTIVITY: Record<WorkspaceSummary["status"], number> = { active: 1, idle: 0.55, quiet: 0.25, churned: 0.15, "never-ran": 0 };

/** Product behaviours the simulator does not model directly, drawn per workspace and conditioned on how active it is. */
export function behavioursOf(w: WorkspaceSummary, paid: boolean): Behaviours {
  const r = mulberry32(parseInt(fnv1a(`beh:${w.id}`), 16));
  const a = STATUS_ACTIVITY[w.status];
  return {
    scheduled: r() < 0.06 + 0.5 * a * (paid ? 1 : 0.6),
    waterfall: r() < 0.05 + (paid ? 0.55 : 0.25) * a,
    ownKey: r() < (w.model === "switched" ? 0.35 : w.topUpper ? 0.3 : 0.08) * (0.4 + a),
    crm: r() < (paid ? 0.12 + 0.4 * a : 0.04),
    template: r() < (w.source === "referral" ? 0.45 : 0.22) * (0.5 + a / 2),
  };
}

// ------------------------------------------------------------------ slices

export type SliceDim = "all" | "region" | "plan" | "source" | "age" | "behaviour";
export interface Slice {
  dim: SliceDim;
  value: string;
}
export const ALL: Slice = { dim: "all", value: "all" };

export const SLICE_DIMS: { id: SliceDim; label: string }[] = [
  { id: "all", label: "Everyone" },
  { id: "region", label: "Region" },
  { id: "plan", label: "Plan" },
  { id: "source", label: "Acquisition source" },
  { id: "age", label: "Account age" },
  { id: "behaviour", label: "Behaviour" },
];

const REGION_NAMES: Record<string, string> = { us: "United States", eu: "European Union", in: "India" };
export const regionName = (id: string) => REGION_NAMES[id] ?? id.toUpperCase();
export const sourceName = (id: string) => id.replace(/-/g, " ").replace(/^./, (c) => c.toUpperCase());

const AGE = [
  { id: "new", label: "Under 30 days", test: (d: number) => d < 30 },
  { id: "young", label: "30–89 days", test: (d: number) => d >= 30 && d < 90 },
  { id: "mature", label: "90 days or more", test: (d: number) => d >= 90 },
];

const BEHAVIOUR_SLICES = [
  { id: "topup", label: "Adds top-ups", test: (w: WorkspaceSummary) => w.topUpper },
  { id: "switched", label: "Switched models", test: (w: WorkspaceSummary) => w.model === "switched" },
  { id: "default", label: "Stays on default model", test: (w: WorkspaceSummary) => w.model === "default" },
  { id: "never", label: "Never ran an enrichment", test: (w: WorkspaceSummary) => w.firstRunDay == null },
];

export function sliceOptions(sim: SimOutput, pack: TenantPack): Record<SliceDim, { value: string; label: string }[]> {
  const uniq = (xs: string[]) => [...new Set(xs)];
  return {
    all: [{ value: "all", label: "Everyone" }],
    region: uniq(sim.workspaces.map((w) => w.region)).sort().map((r) => ({ value: r, label: regionName(r) })),
    plan: pack.plans.filter((p) => sim.workspaces.some((w) => w.planId === p.id)).map((p) => ({ value: p.id, label: p.name })),
    source: Object.keys(sim.config.sources).map((s) => ({ value: s, label: sourceName(s) })),
    age: AGE.map((a) => ({ value: a.id, label: a.label })),
    behaviour: BEHAVIOUR_SLICES.map((b) => ({ value: b.id, label: b.label })),
  };
}

export function inSlice(sim: SimOutput, w: WorkspaceSummary, s: Slice): boolean {
  switch (s.dim) {
    case "all":
      return true;
    case "region":
      return w.region === s.value;
    case "plan":
      return w.planId === s.value;
    case "source":
      return w.source === s.value;
    case "age":
      return AGE.find((a) => a.id === s.value)?.test(ageDays(sim, w)) ?? true;
    case "behaviour":
      return BEHAVIOUR_SLICES.find((b) => b.id === s.value)?.test(w) ?? true;
  }
}

export function sliceLabel(sim: SimOutput, pack: TenantPack, s: Slice): string {
  if (s.dim === "all") return "Everyone";
  return sliceOptions(sim, pack)[s.dim].find((o) => o.value === s.value)?.label ?? s.value;
}

// ------------------------------------------------------------------ weekly retention

export interface WeekRow {
  key: string;
  label: string;
  size: number;
  cells: (number | null)[];
}

/** Still active k weeks after signup: ran in the first week, and was last active at or after week k. */
export function activeAtWeek(w: WorkspaceSummary, k: number): boolean {
  if (w.firstRunDay == null || w.lastActiveDay == null) return false;
  if (k === 0) return w.firstRunDay <= w.signupDay + 6;
  return w.lastActiveDay >= w.signupDay + 7 * k;
}

export function weeklyHeatmap(sim: SimOutput, slice: Slice, filter: (w: WorkspaceSummary) => boolean = () => true, weeks = 10): { columns: string[]; rows: WeekRow[] } {
  const D = lastDay(sim);
  const start = new Date(sim.windowStart);
  const rows: WeekRow[] = [];
  for (let c = weeks - 1; c >= 0; c--) {
    const from = D - 7 * (c + 1) + 1;
    const to = D - 7 * c;
    const xs = sim.workspaces.filter((w) => w.signupDay >= from && w.signupDay <= to && inSlice(sim, w, slice) && filter(w));
    const cells: (number | null)[] = [];
    for (let k = 0; k < weeks; k++) {
      const eligible = xs.filter((w) => w.signupDay + 7 * k <= D);
      cells.push(k > c || eligible.length < 3 ? null : eligible.filter((w) => activeAtWeek(w, k)).length / eligible.length);
    }
    const d = addDays(start, from);
    rows.push({ key: `w${c}`, label: d.toLocaleDateString("en-GB", { day: "numeric", month: "short" }), size: xs.length, cells });
  }
  return { columns: Array.from({ length: weeks }, (_, i) => `W${i}`), rows };
}

// ------------------------------------------------------------------ segments: at risk and thriving

export interface Segment {
  id: string;
  lane: "risk" | "thrive" | "other";
  label: string;
  description: string;
  size: number;
  score: number;
  drivers: string[];
  stake: number;
  stakeLabel: string;
  paid: boolean;
}

interface SegDef {
  id: string;
  lane: "risk" | "thrive" | "other";
  label: (pack: TenantPack) => string;
  description: string;
  test: (w: WorkspaceSummary, pack: TenantPack, sim: SimOutput) => boolean;
  paid: boolean;
}

export const SEGMENTS: SegDef[] = [
  {
    id: "free-quiet",
    lane: "risk",
    label: (p) => `${freePlan(p)?.name ?? "Free"} · quiet before a first enrichment`,
    description: "Signed up, then ran nothing or almost nothing and went quiet.",
    test: (w, pack) => !isPaid(pack, w) && (w.status === "never-ran" || (w.status === "quiet" && w.runs <= 3)),
    paid: false,
  },
  {
    id: "free-blocked",
    lane: "risk",
    label: (p) => `${freePlan(p)?.name ?? "Free"} · hit the cap, did not upgrade`,
    description: "Ran out of free credits at least once and is not active now.",
    test: (w, pack) => !isPaid(pack, w) && w.blocked > 0 && w.status !== "active",
    paid: false,
  },
  {
    id: "paid-month3",
    lane: "risk",
    label: () => "Paid · approaching month three without a top-up",
    description: "Paid for two to four months, never added credits: the band where most paid churn happens.",
    test: (w, pack, sim) => isPaid(pack, w) && ageDays(sim, w) >= 55 && ageDays(sim, w) <= 110 && w.status !== "churned" && w.topUps === 0,
    paid: true,
  },
  {
    id: "paid-topup",
    lane: "thrive",
    label: () => "Paid · buys top-ups",
    description: "Paid workspaces that added credits at least once.",
    test: (w, pack) => isPaid(pack, w) && w.topUps > 0,
    paid: true,
  },
  {
    id: "scheduled",
    lane: "thrive",
    label: () => "Runs scheduled tables",
    description: "Set at least one table to refresh on a schedule.",
    test: (w, pack) => w.firstRunDay != null && behavioursOf(w, isPaid(pack, w)).scheduled,
    paid: false,
  },
  {
    id: "switchers",
    lane: "other",
    label: () => "Switched to a cheaper model",
    description: "Moved at least one enrichment off the default model.",
    test: (w) => w.model === "switched" && w.firstRunDay != null,
    paid: false,
  },
  {
    id: "referral-active",
    lane: "thrive",
    label: () => "Referral · active",
    description: "Came by referral and is active today.",
    test: (w) => w.source === "referral" && w.status === "active",
    paid: false,
  },
  {
    id: "free-activated",
    lane: "other",
    label: (p) => `${freePlan(p)?.name ?? "Free"} · activated and active`,
    description: "Ran at least one enrichment and is active now.",
    test: (w, pack) => !isPaid(pack, w) && w.firstRunDay != null && w.status === "active",
    paid: false,
  },
  {
    id: "new-signups",
    lane: "other",
    label: () => "Signed up in the last 30 days",
    description: "Every workspace younger than 30 days.",
    test: (w, _pack, sim) => ageDays(sim, w) < 30,
    paid: false,
  },
  {
    id: "paid-all",
    lane: "other",
    label: () => "All paid workspaces",
    description: "Every workspace on a paid plan that has not cancelled.",
    test: (w, pack) => isPaid(pack, w) && w.status !== "churned",
    paid: true,
  },
  {
    id: "paid-default",
    lane: "other",
    label: () => "Paid · AI research on the default model",
    description: "Paid workspaces that never changed the default model.",
    test: (w, pack) => isPaid(pack, w) && w.model === "default" && w.status !== "churned",
    paid: true,
  },
  {
    id: "quiet-credits",
    lane: "other",
    label: () => "Paid · quiet with unused credits",
    description: "Paid, idle or quiet, with credits that will expire.",
    test: (w, pack, sim) => isPaid(pack, w) && w.status !== "churned" && (w.status === "idle" || w.status === "quiet" || (w.lastActiveDay ?? 0) <= lastDay(sim) - 3),
    paid: true,
  },
  {
    id: "cancel-intent",
    lane: "other",
    label: () => "Paid · opened the cancel flow",
    description: "Paid workspaces that opened cancel this month.",
    test: (w, pack) => isPaid(pack, w) && w.status !== "churned" && parseInt(fnv1a(`cancel:${w.id}`).slice(0, 4), 16) % 100 < 6,
    paid: true,
  },
  {
    id: "card-expiring",
    lane: "other",
    label: () => "Paid · card expires within 30 days",
    description: "Paid workspaces whose default card expires before the next renewal.",
    test: (w, pack) => isPaid(pack, w) && w.status !== "churned" && parseInt(fnv1a(`card:${w.id}`).slice(0, 4), 16) % 100 < 8,
    paid: true,
  },
];

const memo = new WeakMap<SimOutput, Map<string, unknown>>();
function cached<T>(sim: SimOutput, key: string, fn: () => T): T {
  let m = memo.get(sim);
  if (!m) memo.set(sim, (m = new Map()));
  if (!m.has(key)) m.set(key, fn());
  return m.get(key) as T;
}

export function segmentMembers(sim: SimOutput, pack: TenantPack, id: string): WorkspaceSummary[] {
  return cached(sim, `members:${id}`, () => {
    const def = SEGMENTS.find((s) => s.id === id);
    return def ? sim.workspaces.filter((w) => def.test(w, pack, sim)) : [];
  });
}

const median = (xs: number[]) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};

function overRep(sim: SimOutput, xs: WorkspaceSummary[], base: WorkspaceSummary[], key: "source" | "region"): { value: string; ratio: number } | null {
  let best: { value: string; ratio: number } | null = null;
  const vals = [...new Set(base.map((w) => w[key]))];
  for (const v of vals) {
    const a = xs.filter((w) => w[key] === v).length / Math.max(1, xs.length);
    const b = base.filter((w) => w[key] === v).length / Math.max(1, base.length);
    if (b > 0 && a / b > (best?.ratio ?? 1.1)) best = { value: v, ratio: a / b };
  }
  return best;
}

/** Free-to-paid rate the population shows for activated free workspaces: what a rescued free account is worth. */
export function entryPrice(pack: TenantPack): number {
  return pack.plans.find((p) => p.paid && !p.proposed && p.price != null)?.price ?? 0;
}

export function segments(t: Pick<TenantState, "pack" | "population" | "clock"> & { growth?: { anchor: string } }): Segment[] {
  const sim = growthSim(t);
  const pack = t.pack;
  return cached(sim, `segments:${pack.id}`, () =>
    SEGMENTS.map((d) => {
      const xs = segmentMembers(sim, pack, d.id);
      const base = sim.workspaces.filter((w) => isPaid(pack, w) === d.paid);
      const drivers: string[] = [];
      let score = 0;
      let stake = 0;
      let stakeLabel = "";
      if (d.id === "free-quiet") {
        const never = xs.filter((w) => w.firstRunDay == null).length / Math.max(1, xs.length);
        const quietDay = median(xs.filter((w) => w.lastActiveDay != null).map((w) => (w.lastActiveDay ?? 0) - w.signupDay));
        drivers.push(`${fmtPct(never)} never ran an enrichment after signing up`);
        drivers.push(`The rest went quiet a median ${quietDay} days after signup`);
        const o = overRep(sim, xs, base, "source");
        drivers.push(o ? `${sourceName(o.value)} signups are ${o.ratio.toFixed(1)}× over-represented` : "Spread evenly across acquisition sources");
        score = Math.round(55 + 40 * never);
        stake = xs.length * 0.04 * entryPrice(pack);
        stakeLabel = `${fmtUsd(stake * scaleOf(pack), 0)} MRR a month if 4% convert at ${fmtUsd(entryPrice(pack), 0)}`;
      } else if (d.id === "free-blocked") {
        const blocks = median(xs.map((w) => w.blocked));
        const quiet = xs.filter((w) => w.status === "quiet" || w.status === "idle").length / Math.max(1, xs.length);
        drivers.push(`Blocked a median ${blocks} times by the free cap`);
        drivers.push(`${fmtPct(quiet)} went quiet after the block instead of upgrading`);
        const o = overRep(sim, xs, base, "region");
        drivers.push(o ? `${regionName(o.value)} is ${o.ratio.toFixed(1)}× over-represented` : "No region stands out");
        score = Math.round(50 + 35 * quiet);
        stake = xs.length * 0.08 * entryPrice(pack);
        stakeLabel = `${fmtUsd(stake * scaleOf(pack), 0)} MRR a month if 8% convert`;
      } else if (d.id === "paid-month3") {
        const def = xs.filter((w) => w.model === "default").length / Math.max(1, xs.length);
        const band = sim.workspaces.filter((w) => isPaid(pack, w) && ageDays(sim, w) >= 80);
        const left = band.filter((w) => w.status === "churned").length / Math.max(1, band.length);
        const leftNoTop = band.filter((w) => w.topUps === 0);
        const leftTop = band.filter((w) => w.topUps > 0);
        const rate = (ys: WorkspaceSummary[]) => ys.filter((w) => w.status === "churned").length / Math.max(1, ys.length);
        drivers.push(`${fmtPct(left)} of paid workspaces older than 80 days have already left`);
        drivers.push(`${fmtPct(def)} still run AI research on the costliest default model`);
        drivers.push(`${fmtPct(leftNoTop.length / Math.max(1, band.length))} of paid workspaces past 80 days never bought a top-up; ${fmtPct(rate(leftNoTop))} of them have left`);
        void leftTop;
        score = Math.round(55 + 30 * left + 15 * def);
        stake = xs.reduce((s, w) => s + w.revenue / 3, 0);
        stakeLabel = `${fmtUsd(stake * scaleOf(pack), 0)} MRR at stake`;
      } else if (d.lane === "other") {
        const active = xs.filter((w) => w.status === "active").length / Math.max(1, xs.length);
        drivers.push(`${fmtNum(xs.length * scaleOf(pack))} workspaces, ${fmtPct(active)} active now`);
        const o = overRep(sim, xs, sim.workspaces, "region");
        if (o) drivers.push(`${regionName(o.value)} is ${o.ratio.toFixed(1)}× over-represented`);
        stake = d.paid ? xs.reduce((s, w) => s + w.revenue / 3, 0) : xs.length * 0.04 * entryPrice(pack);
        stakeLabel = d.paid ? `${fmtUsd(stake * scaleOf(pack), 0)} MRR` : `${fmtUsd(stake * scaleOf(pack), 0)} MRR potential at 4% conversion`;
        score = Math.round(active * 100);
      } else {
        const ret = (ys: WorkspaceSummary[]) => {
          const e = ys.filter((w) => ageDays(sim, w) >= 28 && w.firstRunDay != null);
          return e.length ? e.filter((w) => activeAtWeek(w, 4)).length / e.length : 0;
        };
        const churn = (ys: WorkspaceSummary[]) => ys.filter((w) => w.status === "churned").length / Math.max(1, ys.length);
        const activated = sim.workspaces.filter((w) => w.firstRunDay != null);
        if (d.paid) {
          const arpu = (ys: WorkspaceSummary[]) => ys.reduce((s, w) => s + w.revenue, 0) / Math.max(1, ys.length) / 3;
          const a = arpu(xs);
          const b = arpu(base);
          drivers.push(`Spend ${(a / Math.max(1, b)).toFixed(1)}× the average paid workspace`);
          score = Math.round(Math.min(100, 50 * (a / Math.max(1, b))));
          void churn;
        } else {
          const a = ret(xs);
          const b = ret(activated.filter((w) => !xs.includes(w)));
          drivers.push(`Week-4 retention ${fmtPct(a)} against ${fmtPct(b)} for other activated workspaces`);
          score = Math.round(100 * a);
        }
        const arpu = xs.reduce((s, w) => s + w.revenue, 0) / Math.max(1, xs.length) / 3;
        drivers.push(`${fmtUsd(arpu, 0)} a month per workspace`);
        const o = overRep(sim, xs, d.paid ? base : sim.workspaces, "source");
        drivers.push(o ? `${sourceName(o.value)} is ${o.ratio.toFixed(1)}× over-represented` : "Spread across sources");
        stake = xs.reduce((s, w) => s + w.revenue / 3, 0);
        stakeLabel = `${fmtUsd(stake * scaleOf(pack), 0)} MRR a month`;
      }
      return { id: d.id, lane: d.lane, label: d.label(pack), description: d.description, size: xs.length * scaleOf(pack), score, drivers, stake: stake * scaleOf(pack), stakeLabel, paid: d.paid };
    }),
  );
}

export interface BehaviourEffect {
  key: keyof Behaviours;
  label: string;
  inSegment: number;
  baseline: number;
  /** Difference in week-4 retention between workspaces with and without the behaviour, in points. */
  effectPts: number;
  n: number;
}

/** What a thriving segment does differently, with effect sizes on week-4 retention across the population. */
export function thrivingBehaviours(sim: SimOutput, pack: TenantPack, segmentId: string): BehaviourEffect[] {
  return cached(sim, `beh:${segmentId}`, () => {
    const xs = segmentMembers(sim, pack, segmentId);
    const def = SEGMENTS.find((s) => s.id === segmentId);
    const base = sim.workspaces.filter((w) => w.firstRunDay != null && (!def || isPaid(pack, w) === def.paid || !def.paid));
    const elig = base.filter((w) => ageDays(sim, w) >= 28);
    const keys = Object.keys(BEHAVIOUR_LABELS) as (keyof Behaviours)[];
    const beh = new Map(sim.workspaces.map((w) => [w.id, behavioursOf(w, isPaid(pack, w))]));
    return keys
      .map((k) => {
        const share = (ys: WorkspaceSummary[]) => ys.filter((w) => beh.get(w.id)![k]).length / Math.max(1, ys.length);
        const withB = elig.filter((w) => beh.get(w.id)![k]);
        const without = elig.filter((w) => !beh.get(w.id)![k]);
        const r = (ys: WorkspaceSummary[]) => (ys.length ? ys.filter((w) => activeAtWeek(w, 4)).length / ys.length : 0);
        return { key: k, label: BEHAVIOUR_LABELS[k], inSegment: share(xs), baseline: share(base), effectPts: Math.round((r(withB) - r(without)) * 100), n: withB.length };
      })
      .sort((a, b) => b.inSegment - b.baseline - (a.inSegment - a.baseline));
  });
}

export function segmentById(t: Parameters<typeof segments>[0], id: string): Segment | null {
  return segments(t).find((s) => s.id === id) ?? null;
}

export function primaryLabel(pack: TenantPack): string {
  return primaryMeter(pack).label;
}
