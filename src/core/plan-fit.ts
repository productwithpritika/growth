// Plan Fit (Phase 2 §2.7): replay the last 90 days of demand, in three 30-day windows,
// against every plan and meter-size combination. Reports the cheapest fit (top-ups allowed)
// and the cheapest one that never runs out (no top-ups needed).
import type { TenantState } from "@/core/types";
import { DAY_MS, r2 } from "@/core/time";
import { ladder, meterOf, planOf, rateOf, topUpAllowed, topUpUnitPrice } from "@/core/pack";
import { configAllowance, configMonthly, currentConfig, type PlanConfig } from "@/core/hub-actions";
import { runHistory, type RunRecord } from "@/core/usage-history";

export interface WindowDemand {
  from: string;
  to: string;
  demand: Record<string, number>;
}

export interface FitResult {
  cfg: PlanConfig;
  label: string;
  monthly: number;
  /** Plan price plus top-ups over the 90 days. */
  total: number;
  topUps: number;
  /** Windows where the allowance ran short and top-ups aren't available: work would have stopped. */
  shortWindows: number;
  needsTopUps: boolean;
  /** Per window and meter: demand against the allowance. */
  windows: { meter: string; demand: number; allowance: number; over: number }[][];
}

export function demandWindows(t: TenantState, account: string, runs?: RunRecord[]): WindowDemand[] {
  const rs = runs ?? runHistory(t, account, 90);
  const now = new Date(t.clock).getTime();
  return [2, 1, 0].map((k) => {
    const from = now - (k + 1) * 30 * DAY_MS;
    const to = now - k * 30 * DAY_MS;
    const demand: Record<string, number> = {};
    for (const m of t.pack.meters) demand[m.id] = 0;
    for (const r of rs) {
      const ts = new Date(r.ts).getTime();
      if (ts < from || ts >= to + 1) continue;
      for (const [m, v] of Object.entries(r.demand)) demand[m] = r2((demand[m] ?? 0) + v);
    }
    return { from: new Date(from).toISOString(), to: new Date(to).toISOString(), demand };
  });
}

function needsOf(t: TenantState, runs: RunRecord[]): string[] {
  const out = new Set<string>();
  for (const r of runs) for (const c of r.columns) {
    const req = rateOf(t.pack, c.stepId)?.requires;
    if (req) out.add(req);
  }
  return [...out];
}

export function evaluateFit(t: TenantState, windows: WindowDemand[], cfg: PlanConfig): FitResult | null {
  const plan = planOf(t.pack, cfg.planId);
  const monthly = configMonthly(t, cfg);
  if (monthly == null) return null;
  let topUps = 0;
  let short = 0;
  let needsTopUps = false;
  const rows = windows.map((w) => {
    let shortHere = false;
    const out = t.pack.meters.map((m) => {
      const allowance = configAllowance(t, cfg, m.id);
      const demand = w.demand[m.id] ?? 0;
      const over = r2(Math.max(0, demand - allowance));
      if (over > 0) {
        if (topUpAllowed(t.pack, m.id, plan, "cockpit")) {
          topUps += over * topUpUnitPrice(t.pack, m.id);
          needsTopUps = true;
        } else shortHere = true;
      }
      return { meter: m.id, demand, allowance, over };
    });
    if (shortHere) short++;
    return out;
  });
  const parts = [plan.name, ...Object.entries(cfg.addOns).filter(([, n]) => n > 0).map(([m, n]) => `+${((t.pack.hub.expansion[m]?.step ?? 0) * n).toLocaleString("en-US")} ${meterOf(t.pack, m).label}`)];
  return { cfg, label: parts.join(" "), monthly, total: r2(monthly * windows.length + topUps), topUps: r2(topUps), shortWindows: short, needsTopUps, windows: rows };
}

export interface PlanFit {
  windows: WindowDemand[];
  needs: string[];
  current: FitResult | null;
  cheapest: FitResult | null;
  noRunOut: FitResult | null;
  all: FitResult[];
}

export function planFit(t: TenantState, account: string, billing: "monthly" | "annual" = "monthly"): PlanFit {
  const runs = runHistory(t, account, 90);
  const windows = demandWindows(t, account, runs);
  const needs = needsOf(t, runs);
  const exp = t.pack.hub.expansion;
  const meters = t.pack.meters.map((m) => m.id);
  const all: FitResult[] = [];
  for (const plan of ladder(t.pack, "cockpit")) {
    if (plan.price == null || !needs.every((f) => plan.features.includes(f))) continue;
    const ranges = meters.map((m) => (exp[m] && plan.paid ? exp[m].max : 0));
    const combo = (i: number, acc: Record<string, number>) => {
      if (i === meters.length) {
        const r = evaluateFit(t, windows, { planId: plan.id, billing, addOns: { ...acc } });
        if (r) all.push(r);
        return;
      }
      for (let n = 0; n <= ranges[i]; n++) combo(i + 1, n ? { ...acc, [meters[i]]: n } : acc);
    };
    combo(0, {});
  }
  const viable = all.filter((r) => r.shortWindows === 0);
  const cheapest = viable.reduce<FitResult | null>((b, r) => (!b || r.total < b.total - 0.005 ? r : b), null);
  const noRunOut = viable.filter((r) => !r.needsTopUps).reduce<FitResult | null>((b, r) => (!b || r.total < b.total - 0.005 ? r : b), null);
  const current = evaluateFit(t, windows, currentConfig(t, account));
  return { windows, needs, current, cheapest, noRunOut, all };
}
