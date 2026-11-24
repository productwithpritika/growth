// Free-user lifecycle (Phase 2 §2.12): where an account is, from signed up to converted,
// and the guardrail each stage's moment must respect.
import type { TenantState } from "@/core/types";
import { DAY_MS, cycleOf } from "@/core/time";
import { monthlyAllowance, planOf } from "@/core/pack";
import { usedThisCycle } from "@/core/ledger";
import { sparkStatus } from "@/core/rewards-program";
import { runHistory } from "@/core/usage-history";

export type StageId = "signed-up" | "activated" | "habit" | "near-limit" | "limit-hit" | "never-activated" | "quiet" | "converted";

export interface StageDef {
  id: StageId;
  label: string;
  trigger: string;
  moment: string;
  guardrail: string;
}

export function stageDefs(t: Pick<TenantState, "pack">): StageDef[] {
  const h = t.pack.hub;
  const unit = t.pack.workUnit.many;
  return [
    { id: "signed-up", label: "Signed up", trigger: "Account created", moment: `${h.templateTable}; first win in 5 minutes`, guardrail: "No forced tour" },
    { id: "activated", label: "Activated", trigger: `First enrichment with ${h.activation.minRows} or more verified ${unit}`, moment: `Celebration plus a one-time ${h.activation.amount} credit reward`, guardrail: "One per domain" },
    { id: "habit", label: "Habit", trigger: "3 active days in 7", moment: `${h.spark.label} streak unlocks`, guardrail: "Monthly cap" },
    { id: "near-limit", label: "Near limit", trigger: "80% of a meter", moment: "Estimator plus options", guardrail: "No false urgency" },
    { id: "limit-hit", label: "Limit hit", trigger: "100% of a meter", moment: "Mid-run moment, starter pack or paid trial offer", guardrail: "Offer is experiment-controlled" },
    { id: "never-activated", label: "Never activated", trigger: "No enrichment by day 3", moment: `Agent-led guided first table, day ${h.nudges.humanHelpDay} human-help invite`, guardrail: `Max ${h.nudges.maxNeverActivated} nudges` },
    { id: "quiet", label: "Quiet", trigger: `${h.nudges.quietDays} days inactive`, moment: "Win-back showing credits that will expire", guardrail: "Opt-out honoured" },
    { id: "converted", label: "Converted", trigger: "First payment", moment: "Paid onboarding: limits, teammates, auto top-up", guardrail: "None" },
  ];
}

export interface StageFact {
  state: "reached" | "current" | "not-yet" | "skipped";
  at: string | null;
  detail: string;
}

export interface LifecycleView {
  current: StageId;
  facts: Record<StageId, StageFact>;
  daysSinceSignup: number;
  daysSinceActive: number | null;
  activeDays7: number;
  pctUsed: { meter: string; pct: number }[];
  nudgesUsed: number;
  nudgesMax: number;
  optOut: boolean;
}

export function lifecycleOf(t: TenantState, account: string): LifecycleView {
  const hub = t.hub[account];
  const pack = t.pack;
  const now = new Date(t.clock).getTime();
  const runs = runHistory(t, account, 30);
  const last = runs[0]?.ts ?? null;
  const spark = sparkStatus(t, account);
  const days = new Set(runs.filter((r) => now - new Date(r.ts).getTime() < 7 * DAY_MS).map((r) => r.ts.slice(0, 10)));
  const activeDays7 = Math.max(days.size, spark.activeDays7);
  const pctUsed = pack.meters
    .map((m) => {
      const allow = monthlyAllowance(pack, hub.planId, m.id);
      return { meter: m.id, pct: allow > 0 ? usedThisCycle(t, account, m.id) / allow : 0 };
    })
    .filter((x) => x.pct > 0);
  const maxPct = Math.max(0, ...pctUsed.map((x) => x.pct));
  const pausedRun = hub.runs.some((r) => r.status === "paused" && r.pausedReason?.code === "insufficient_balance");
  const paid = planOf(pack, hub.planId).paid;
  const daysSinceSignup = Math.floor((now - new Date(hub.lifecycle.signedUpAt).getTime()) / DAY_MS);
  const daysSinceActive = last ? Math.floor((now - new Date(last).getTime()) / DAY_MS) : null;
  const activated = !!hub.rewardState.activatedAt;
  const reached = (ok: boolean, at: string | null, detail: string): StageFact => ({ state: ok ? "reached" : "not-yet", at: ok ? at : null, detail });
  const facts: Record<StageId, StageFact> = {
    "signed-up": reached(true, hub.lifecycle.signedUpAt, `${daysSinceSignup} days ago`),
    activated: reached(activated, hub.rewardState.activatedAt, activated ? "First verified run done" : "No qualifying run yet"),
    habit: reached(activeDays7 >= 3, null, `${activeDays7} active day${activeDays7 === 1 ? "" : "s"} in the last 7`),
    "near-limit": reached(maxPct >= 0.8, null, `${Math.round(maxPct * 100)}% of the busiest meter used`),
    "limit-hit": reached(maxPct >= 1 || pausedRun, null, pausedRun ? "A run is paused for credits" : `${Math.round(maxPct * 100)}% used`),
    "never-activated": activated ? { state: "skipped", at: null, detail: "Activated, so this stage never applied" } : reached(daysSinceSignup >= 3, null, `${daysSinceSignup} days without a qualifying run`),
    quiet: reached(daysSinceActive != null && daysSinceActive >= pack.hub.nudges.quietDays, last, daysSinceActive == null ? "No runs in 30 days" : `Last run ${daysSinceActive} day${daysSinceActive === 1 ? "" : "s"} ago`),
    converted: reached(paid || !!hub.lifecycle.convertedAt, hub.lifecycle.convertedAt, paid ? `On ${planOf(pack, hub.planId).name}` : "Free plan"),
  };
  const order: StageId[] = ["converted", "limit-hit", "quiet", "near-limit", "habit", "activated", "never-activated", "signed-up"];
  const current = order.find((s) => facts[s].state === "reached") ?? "signed-up";
  facts[current] = { ...facts[current], state: "current" };
  return {
    current,
    facts,
    daysSinceSignup,
    daysSinceActive,
    activeDays7,
    pctUsed,
    nudgesUsed: hub.lifecycle.nudges.filter((n) => n.kind.startsWith("activation")).length,
    nudgesMax: pack.hub.nudges.maxNeverActivated,
    optOut: hub.lifecycle.optOut,
  };
}

/** Cycle position helpers the lifecycle lens shows. */
export function resetDate(t: TenantState): Date {
  return cycleOf(t).end;
}
