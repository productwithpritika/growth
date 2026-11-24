// Time series the simulator derives from the account population: weekly retention
// cohorts and an activation scorecard (D1 / D3 / D7).
import type { TenantState } from "@/core/types";
import { accountsFor } from "@/sim/population";
import { project } from "@/core/economics";
import { addDays, fnv1a, monthlyAllowanceSafe, mulberry32 } from "@/sim/series-util";
import { planOf } from "@/core/pack";

export interface HeatRow {
  label: string;
  size: number;
  cells: (number | null)[];
}

const seedOf = (s: string) => parseInt(fnv1a(s), 16);

export function retentionHeatmap(t: TenantState, weeks = 8): { columns: string[]; rows: HeatRow[] } {
  const pack = t.pack;
  const accounts = accountsFor(pack);
  const clock = new Date(t.clock);
  const rows: HeatRow[] = [];
  for (let c = weeks - 1; c >= 0; c--) {
    const members = accounts.filter((a) => a.signupWeek === c);
    const weekStart = addDays(clock, -7 * c - clock.getDay() + 1);
    const cells: (number | null)[] = [];
    for (let w = 0; w < weeks; w++) {
      if (w > c || !members.length) {
        cells.push(null);
        continue;
      }
      let active = 0;
      for (const a of members) {
        const paid = planOf(pack, a.planId).paid;
        const lambda = (paid ? 0.06 : 0.22) * (0.6 + 0.8 * mulberry32(seedOf(a.id))());
        const p = w === 0 ? 1 : Math.exp(-lambda * w);
        if (mulberry32(seedOf(`${a.id}:${w}`))() < p) active++;
      }
      cells.push(active / members.length);
    }
    rows.push({ label: weekStart.toLocaleDateString("en-GB", { day: "numeric", month: "short" }), size: members.length, cells });
  }
  return { columns: Array.from({ length: weeks }, (_, i) => `W${i}`), rows };
}

export interface ScoreRow {
  metric: string;
  d1: number;
  d3: number;
  d7: number;
}

/** Share of accounts that signed up in the last two weeks reaching each milestone by day 1, 3 and 7. */
export function activationScorecard(t: TenantState): { size: number; rows: ScoreRow[] } {
  const pack = t.pack;
  const fresh = accountsFor(pack).filter((a) => a.signupWeek <= 1);
  const prim = pack.meters[0];
  const days = fresh.map((a) => {
    const r = mulberry32(seedOf(`act:${a.id}`));
    const firstRun = r() < 0.82 ? Math.floor(r() * 3) + (r() < 0.3 ? 1 : 0) : 99;
    const allow = monthlyAllowanceSafe(pack, a.planId, prim.id, a.demand[prim.id] ?? 1);
    const perDay = Math.max(0.0001, (a.demand[prim.id] ?? 0) / 30);
    const quarter = firstRun + (0.25 * allow) / perDay;
    const p = project(pack, a);
    const cap = p.capDay != null ? Math.max(firstRun, p.capDay) : 99;
    const paidDay = planOf(pack, a.planId).paid ? firstRun + Math.floor(r() * 5) : cap < 99 && r() < 0.18 ? cap + Math.floor(r() * 4) : 99;
    return { firstRun, quarter, cap, paidDay };
  });
  const share = (k: "firstRun" | "quarter" | "cap" | "paidDay", d: number) => (days.length ? days.filter((x) => x[k] <= d).length / days.length : 0);
  const row = (metric: string, k: "firstRun" | "quarter" | "cap" | "paidDay"): ScoreRow => ({ metric, d1: share(k, 1), d3: share(k, 3), d7: share(k, 7) });
  return {
    size: fresh.length,
    rows: [row("Ran a first workflow", "firstRun"), row(`Used a quarter of the allowance`, "quarter"), row("Hit a cap", "cap"), row("Topped up or paid", "paidDay")],
  };
}
