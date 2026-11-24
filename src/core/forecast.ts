// Run-out forecasting as pure functions: a trailing 7-day burn, weighted by weekday,
// projected forward with a confidence band that widens with the square root of time.
import { r2 } from "@/core/time";

/** Sunday-first weekday profile for B2B work when there is too little history to learn one. Mean is 1. */
export const DEFAULT_WEEKDAY = normalise([0.45, 1.15, 1.2, 1.2, 1.15, 1.0, 0.5]);
export const Z80 = 1.2816;

export interface DayUse {
  /** Day of week, 0 = Sunday. */
  dow: number;
  used: number;
}

function normalise(w: number[]): number[] {
  const mean = w.reduce((a, b) => a + b, 0) / w.length;
  return mean > 0 ? w.map((x) => x / mean) : w.map(() => 1);
}

/**
 * Weekday weights learned from history, shrunk toward a prior: with k = 2, a weekday seen twice is
 * half its own average and half the prior. Weights average to 1.
 */
export function weekdayWeights(history: DayUse[], prior: number[] = DEFAULT_WEEKDAY, k = 2): number[] {
  const total = history.reduce((s, d) => s + d.used, 0);
  if (history.length < 7 || total <= 0) return [...prior];
  const mean = total / history.length;
  const sum = new Array<number>(7).fill(0);
  const n = new Array<number>(7).fill(0);
  for (const d of history) {
    sum[d.dow] += d.used;
    n[d.dow] += 1;
  }
  const raw = prior.map((p, i) => (n[i] ? (sum[i] / n[i] / mean) * (n[i] / (n[i] + k)) + p * (k / (n[i] + k)) : p));
  return normalise(raw);
}

/** Weekday-neutral daily burn over the last `window` days: what was used divided by how much weekday weight those days carried. */
export function baseRate(history: DayUse[], weights: number[], window = 7): number {
  const last = history.slice(-window);
  const w = last.reduce((s, d) => s + weights[d.dow], 0);
  return w > 0 ? last.reduce((s, d) => s + d.used, 0) / w : 0;
}

/** Standard deviation of daily residuals (actual − base × weight) over the last `window` days. */
export function residualSd(history: DayUse[], weights: number[], base: number, window = 14): number {
  const last = history.slice(-window);
  if (last.length < 2) return 0;
  const res = last.map((d) => d.used - base * weights[d.dow]);
  const m = res.reduce((a, b) => a + b, 0) / res.length;
  return Math.sqrt(res.reduce((a, b) => a + (b - m) ** 2, 0) / (res.length - 1));
}

export type Confidence = "high" | "medium" | "low";

export interface ForecastDay {
  offset: number; // days from today, 1 = tomorrow
  dow: number;
  expected: number; // that day's expected use
  cumMid: number;
  cumLo: number;
  cumHi: number;
  available: number; // cumulative credits available by the end of that day
}

export interface Forecast {
  base: number;
  weights: number[];
  sd: number;
  confidence: Confidence;
  days: ForecastDay[];
  /** Day offsets when the projection, its high edge and its low edge cross what is available. */
  runOut: { mid: number | null; early: number | null; late: number | null };
}

export interface ForecastInput {
  history: DayUse[]; // oldest first, through yesterday
  balance: number; // available now
  todayDow: number; // day of week of the first projected day minus one
  horizon: number; // days to project
  inflow?: (offset: number) => number; // credits that arrive on a future day (daily grants)
  z?: number;
  prior?: number[];
}

/** Pure: project use day by day and find when it crosses the balance, with an 80% band by default. */
export function forecastRunOut(i: ForecastInput): Forecast {
  const weights = weekdayWeights(i.history, i.prior);
  const base = baseRate(i.history, weights);
  const sd = residualSd(i.history, weights, base);
  const z = i.z ?? Z80;
  const cv = base > 0 ? sd / base : 1;
  const confidence: Confidence = i.history.length >= 14 && cv < 0.5 ? "high" : i.history.length >= 7 ? "medium" : "low";
  const days: ForecastDay[] = [];
  let cum = 0;
  let avail = i.balance;
  const runOut: Forecast["runOut"] = { mid: null, early: null, late: null };
  for (let n = 1; n <= i.horizon; n++) {
    const dow = (i.todayDow + n) % 7;
    const expected = base * weights[dow];
    cum += expected;
    avail += i.inflow?.(n) ?? 0;
    const spread = z * sd * Math.sqrt(n);
    const lo = Math.max(0, cum - spread);
    const hi = cum + spread;
    if (base > 0) {
      if (runOut.mid == null && cum >= avail - 0.05) runOut.mid = n;
      if (runOut.early == null && hi >= avail - 0.05) runOut.early = n;
      if (runOut.late == null && lo >= avail - 0.05) runOut.late = n;
    }
    days.push({ offset: n, dow, expected: r2(expected), cumMid: r2(cum), cumLo: r2(lo), cumHi: r2(hi), available: r2(avail) });
  }
  return { base: r2(base), weights: weights.map((w) => Math.round(w * 1000) / 1000), sd: r2(sd), confidence, days, runOut };
}
