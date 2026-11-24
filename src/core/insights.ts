// Insights both surfaces read: customer-side (Credits Hub) and tenant-side (Growth Workbench).
import type { Insight, TenantState } from "@/core/types";
import { amountText, fmtUsd } from "@/core/format";
import { CYCLE_DAYS, DAY_MS, addDays, cycleOf, daysText, fmtDay, startOfDay } from "@/core/time";
import { meterTimeline } from "@/core/forecasting";
import { usageDrivers } from "@/core/metering";
import { compareArms, workbenchStats } from "@/core/economics";
import { freePlan, meterOf, planOf, primaryMeter, unitNoun } from "@/core/pack";

export function hubInsights(t: TenantState, personaId: string): Insight[] {
  const out: Insight[] = [];
  const { start, end } = cycleOf(t);
  const hub = t.hub[personaId];
  if (!hub) return out;
  for (const m of t.pack.meters) {
    const tl = meterTimeline(t, personaId, m.id);
    if (tl.ranOutAt) {
      const days = Math.round((end.getTime() - startOfDay(new Date(tl.ranOutAt)).getTime()) / DAY_MS);
      out.push({ id: `ran-${m.id}`, surface: "hub", persona: personaId, tone: "blocked", title: `${m.label} ran out on ${fmtDay(tl.ranOutAt)}, ${daysText(days)} before reset`, source: "Ledger" });
    } else if (tl.runsOutDay != null) {
      out.push({ id: `runs-${m.id}`, surface: "hub", persona: personaId, tone: "atRisk", title: `At ${amountText(m, tl.rate, { label: false, digits: m.valueType === "currency" ? 2 : 0 })} a day, ${m.label} ${m.valueType === "currency" ? "runs" : "run"} out on ${fmtDay(addDays(start, tl.runsOutDay))}, ${daysText(CYCLE_DAYS - tl.runsOutDay)} before reset`, source: "Forecast" });
    }
    if (!tl.ranOutAt && tl.expiring.amount >= 1 && tl.expiring.firstAt) {
      out.push({ id: `exp-${m.id}`, surface: "hub", persona: personaId, tone: "watch", title: `${amountText(m, tl.expiring.amount)} expire on ${fmtDay(tl.expiring.firstAt)}`, source: "Ledger" });
    }
    if (tl.held > 0) out.push({ id: `held-${m.id}`, surface: "hub", persona: personaId, tone: "info", title: `${amountText(m, tl.held)} held for a run in flight`, source: "Ledger" });
  }
  const failed = hub.charges.find((c) => c.status === "failed");
  if (failed) out.push({ id: "failed", surface: "hub", persona: personaId, tone: "blocked", title: `${failed.description} for ${fmtUsd(failed.amount)} failed on ${fmtDay(failed.ts)}: ${failed.reason ?? "declined"}`, source: "Events" });
  const prim = primaryMeter(t.pack);
  const drivers = usageDrivers(t, personaId);
  const total = drivers.reduce((a, d) => a + (d.meters[prim.id] ?? 0), 0);
  const top = [...drivers].sort((a, b) => (b.meters[prim.id] ?? 0) - (a.meters[prim.id] ?? 0))[0];
  if (top && total > 0 && drivers.length > 1) out.push({ id: "driver", surface: "hub", persona: personaId, tone: "info", title: `${top.workflow} used ${Math.round(((top.meters[prim.id] ?? 0) / total) * 100)}% of ${prim.label} this cycle`, source: "Events" });
  return out;
}

export function workbenchInsights(t: TenantState): Insight[] {
  const pack = t.pack;
  const w = workbenchStats(pack);
  const free = freePlan(pack);
  const freeCount = free ? w.accounts.filter((a) => !planOf(pack, a.planId).paid).length : 0;
  const prim = primaryMeter(pack);
  const out: Insight[] = [];
  if (free && freeCount) {
    const [mid, share] = Object.entries(w.firstCapShare).sort((a, b) => b[1] - a[1])[0] ?? [prim.id, 0];
    const first = pack.meters.length > 1 ? `; ${Math.round(share * 100)}% of them ran out of ${meterOf(pack, mid).label} first` : "";
    out.push({ id: "capped", surface: "workbench", tone: "watch", title: `${Math.round((w.freeCapped.length / freeCount) * 100)}% of ${free.name} accounts hit a cap this cycle${first}`, source: "Cohorts" });
    out.push({
      id: "gap",
      surface: "workbench",
      tone: "info",
      title: `Median cost for a capped ${free.name} account to keep working: ${w.todayGap != null ? fmtUsd(w.todayGap, 0) : "custom contract"} today, ${fmtUsd(w.cockpitGap)} with Cockpit proposals`,
      source: "Plan fit",
    });
  }
  if (w.breakageUsd > 0.5) out.push({ id: "breakage", surface: "workbench", tone: "neutral", title: `${fmtUsd(w.breakageUsd, 0)} of paid allowance will expire unused this cycle`, source: "Ledger" });
  out.push({ id: "margin", surface: "workbench", tone: w.marginPct >= 0.5 ? "healthy" : "watch", title: `Gross margin per ${unitNoun(prim)}: ${fmtUsd(w.marginPerUnit, 3)} (${Math.round(w.marginPct * 100)}%)`, source: "Rate card" });
  if (w.failing) out.push({ id: "failing", surface: "workbench", tone: "blocked", title: `${w.failing} paid accounts have failed payments · ${fmtUsd(w.failingMrr, 0)} MRR at risk`, source: "Events" });
  for (const e of t.experiments.filter((x) => x.status !== "draft" && x.arms.length >= 2)) {
    const c = compareArms(e.arms[0], e.arms[1]);
    if (c && c.p1 > 0) out.push({ id: `exp-${e.id}`, surface: "workbench", tone: c.pValue < 0.05 ? "healthy" : "neutral", title: `${e.name}: ${c.lift >= 0 ? "+" : ""}${Math.round(c.lift * 100)}% on ${e.metric.toLowerCase()} (p = ${c.pValue < 0.001 ? "<0.001" : c.pValue.toFixed(3)})`, source: "Experiments" });
  }
  return out;
}
