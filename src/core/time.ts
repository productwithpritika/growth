// Clock, cycle and deterministic randomness helpers.
export const CYCLE_DAYS = 30;
export const TODAY_INDEX = 22; // a freshly seeded tenant sits on day 23 of a 30-day cycle
export const DAY_MS = 86_400_000;

export const r1 = (n: number) => Math.round(n * 10) / 10;
export const r2 = (n: number) => Math.round(n * 100) / 100;
export const daysText = (n: number) => `${n} day${n === 1 ? "" : "s"}`;
export const fmtDay = (d: Date | string) => new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short" });

export function startOfDay(d: Date): Date {
  const x = new Date(d.getTime());
  x.setHours(0, 0, 0, 0);
  return x;
}
export function addDays(d: Date, n: number): Date {
  const x = new Date(d.getTime());
  x.setDate(x.getDate() + n);
  return x;
}

/** The billing cycle around a clock: from a stored cycle start, or day 23 of 30 for a fresh seed. */
export function cycleOf(x: string | { clock: string; cycleStart?: string }) {
  const clockIso = typeof x === "string" ? x : x.clock;
  const clock = new Date(clockIso);
  const start = typeof x !== "string" && x.cycleStart ? startOfDay(new Date(x.cycleStart)) : addDays(startOfDay(clock), -TODAY_INDEX);
  const end = addDays(start, CYCLE_DAYS);
  const day = Math.round((startOfDay(clock).getTime() - start.getTime()) / DAY_MS);
  return { start, end, day, clock };
}

export function dayIndexOf(ts: string, start: Date): number {
  return Math.floor((new Date(ts).getTime() - start.getTime()) / DAY_MS);
}

export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function normal(rng: () => number): number {
  const u = Math.max(rng(), 1e-9);
  const v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

export function fnv1a(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

export function median(xs: number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}
