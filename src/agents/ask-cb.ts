// Ask CB: the bounded snapshot of the brain sent with each question. The inline agent keeps
// no memory between messages, so every question carries it.
import type { TenantState } from "@/core/types";
import { amountText, fmtUsd } from "@/core/format";
import { atRisk, cohortDefs, workbenchStats } from "@/core/economics";
import { meterTimeline } from "@/core/forecasting";
import { workbenchInsights } from "@/core/insights";
import { grantRule, monthlyAllowance, packsFor, planOf, primaryMeter, unitNoun } from "@/core/pack";
import { personaRole } from "@/tenants/personas";

export interface ContextSection {
  title: string;
  lines: string[];
}

export function askSections(t: TenantState): ContextSection[] {
  const pack = t.pack;
  const w = workbenchStats(pack);
  const prim = primaryMeter(pack);
  const sections: ContextSection[] = [];
  sections.push({
    title: `Tenant · ${pack.company} (${pack.category}, ${pack.billingModel}), billed per ${pack.workUnit.one}`,
    lines: pack.meters.map((m) => {
      const packs = packsFor(pack, m.id).map((p) => `${amountText(m, p.units)} for ${fmtUsd(p.price)}${p.validityDays ? ` (valid ${p.validityDays} days)` : ""}${p.proposed ? " (proposed)" : ""}`);
      return `${m.label}: list ${fmtUsd(m.pricePerUnit, 4)} per ${m.unit.replace(/s$/, "")}; top-ups ${packs.join(", ") || "none"}`;
    }),
  });
  sections.push({
    title: "Plans and grant rules",
    lines: pack.plans.map((p) => {
      const grants = pack.meters
        .map((m) => {
          const g = grantRule(pack, p.id, m.id);
          return `${amountText(m, monthlyAllowance(pack, p.id, m.id))}/month (${g.cadence}${g.monthlyCap ? `, cap ${g.monthlyCap}` : ""}, rollover ${g.rollover.mode}${g.rollover.mode === "capped" ? ` ${g.rollover.capX}×` : ""})`;
        })
        .join("; ");
      return `${p.name}${p.proposed ? " (proposed)" : ""}: ${p.price == null ? "custom" : fmtUsd(p.price, 0)}/mo; ${grants}${p.caps.monthlySpend ? `; spend cap ${fmtUsd(p.caps.monthlySpend, 0)}` : ""}`;
    }),
  });
  sections.push({
    title: "Business this cycle",
    lines: [
      `${w.accounts.length} accounts, ${w.paid.length} paid; paid MRR ${fmtUsd(w.mrr, 0)}`,
      `Gross margin per ${unitNoun(prim)}: ${fmtUsd(w.marginPerUnit, 3)} (${Math.round(w.marginPct * 100)}%)`,
      `Breakage (paid allowance expiring unused): ${fmtUsd(w.breakageUsd, 0)}`,
      ...(pack.byokDiscount ? [`${prim.label} revenue forgone to own API keys: ${fmtUsd(w.byokForgone, 0)} a month`] : []),
      `Failed payments: ${w.failing} accounts, ${fmtUsd(w.failingMrr, 0)} MRR`,
      `Median monthly cost for a capped free account to keep working: ${w.todayGap != null ? fmtUsd(w.todayGap, 0) : "custom"} today vs ${fmtUsd(w.cockpitGap)} with Cockpit proposals`,
    ],
  });
  sections.push({ title: "Cohorts (account counts)", lines: cohortDefs(pack).map((c) => `${c.label}: ${w.accounts.filter((a) => c.test(a, w.projections.get(a.id)!, planOf(pack, a.planId))).length}`) });
  const risks = atRisk(pack, w.accounts);
  sections.push({ title: "Churn arrest", lines: [`${risks.length} paid accounts at risk, ${fmtUsd(risks.reduce((s, r) => s + r.mrr, 0), 0)} MRR; save plays applied to ${Object.keys(t.saves).length}`] });
  sections.push({
    title: "Experiments",
    lines: (t.growth?.lab ?? []).map((e) => `${e.name} [${e.status}, day ${e.days.length}] audience ${e.audience.label} (${e.audience.size}), metric ${e.metric}, layer ${e.layer}${e.decision ? `, decided ${e.decision.verdict}` : ""}`),
  });
  sections.push({
    title: "Customer accounts in the Credits Hub",
    lines: (["maya", "dev"] as const).map((id) => {
      const h = t.hub[id];
      const plan = planOf(pack, h.planId);
      const meters = pack.meters
        .map((m) => {
          const tl = meterTimeline(t, id, m.id);
          return `${m.label} ${amountText(m, tl.balance, { label: false })} left of ${amountText(m, tl.available, { label: false })}${tl.ranOutAt ? " (ran out)" : tl.runsOutDay != null ? " (runs out before reset)" : ""}`;
        })
        .join("; ");
      const failed = h.charges.filter((c) => c.status === "failed").length;
      return `${id === "maya" ? "Maya" : "Dev"}, ${personaRole(pack, id, plan.name)}: ${meters}${failed ? `; ${failed} failed payment` : ""}`;
    }),
  });
  sections.push({ title: "Live insights", lines: workbenchInsights(t).map((i) => i.title) });
  return sections;
}

export function askMessage(t: TenantState, question: string): string {
  const data = askSections(t)
    .map((s) => `## ${s.title}\n${s.lines.map((l) => `- ${l}`).join("\n")}`)
    .join("\n\n");
  return [
    `You are Ask CB, the analyst inside Chargebee's Monetization Cockpit, helping ${t.pack.company}'s growth and finance team.`,
    "Answer using only the cockpit data below. Quote the numbers you rely on. If the data cannot answer the question, say so and name what data would. Keep it short: a direct answer first, then up to five bullets.",
    "",
    "# Cockpit data",
    data,
    "",
    "# Question",
    question,
  ].join("\n");
}
