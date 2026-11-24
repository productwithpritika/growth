// Typed reasons a run is blocked, and the MomentCard each one renders as.
// Metering returns a BlockReason instead of a string so every surface can explain
// the block the same way and offer the action that clears it.
import type { TenantPack } from "@/tenants/schema";
import type { Tone } from "@/core/types";
import { amountText, fmtUsd } from "@/core/format";
import { meterOf } from "@/core/pack";

export type BlockReason =
  | { code: "insufficient_balance"; meter: string; needed: number; available: number }
  | { code: "budget_reached"; workflow: string; budget: number; spent: number }
  | { code: "channel_cap"; channel: string; cap: number; spent: number }
  | { code: "tier_cap"; plan: string; cap: number; spent: number }
  | { code: "subscription_paused" }
  | { code: "plan_feature"; feature: string; step: string }
  | { code: "spend_limit"; scope: "member" | "table" | "workspace"; target: string; meter: string; limit: number; spent: number }
  | { code: "payment_overdue"; graceEnded: string; amount: number };

export type BlockCode = BlockReason["code"];
export const BLOCK_CODES: BlockCode[] = ["insufficient_balance", "budget_reached", "channel_cap", "tier_cap", "subscription_paused", "plan_feature", "spend_limit", "payment_overdue"];

/** What clears the block; the Hub maps each to a tab or action. */
export type BlockAction = "top-up" | "limits" | "plan" | "resume" | "billing";

export interface BlockMoment {
  tone: Tone;
  trigger: string;
  headline: string;
  evidence: string;
  action: { kind: BlockAction; label: string };
}

/** The legacy `limitedBy` string kept on events, for filters that predate typed reasons. */
export function limitedByOf(r: BlockReason): string {
  switch (r.code) {
    case "insufficient_balance":
      return r.meter;
    case "budget_reached":
      return "budget";
    case "channel_cap":
      return "mcp";
    case "tier_cap":
      return "tier-cap";
    case "subscription_paused":
      return "paused";
    case "plan_feature":
      return "feature";
    case "spend_limit":
      return "limit";
    case "payment_overdue":
      return "payment";
  }
}

/** Pure: a blocked run's reason → the MomentCard content that explains it. */
export function blockMoment(pack: TenantPack, r: BlockReason, money: (usd: number) => string = (n) => fmtUsd(n)): BlockMoment {
  switch (r.code) {
    case "insufficient_balance": {
      const m = meterOf(pack, r.meter);
      const verb = m.valueType === "currency" ? "Add funds" : "Top up";
      return {
        tone: "blocked",
        trigger: `Ledger · not enough ${m.label}`,
        headline: `Needs ${amountText(m, r.needed)}; ${amountText(m, r.available)} available`,
        evidence: `The run would take the balance below zero, which ${pack.company} doesn't allow on this plan. Nothing was charged.`,
        action: { kind: "top-up", label: verb },
      };
    }
    case "budget_reached":
      return {
        tone: "watch",
        trigger: "Limits · workflow budget",
        headline: `${r.workflow} reached its budget`,
        evidence: `${amountText(pack.meters[0], r.spent)} used against a ${amountText(pack.meters[0], r.budget)} budget this cycle. Raise or clear the budget to run it.`,
        action: { kind: "limits", label: "Change budget" },
      };
    case "channel_cap":
      return {
        tone: "watch",
        trigger: `Limits · ${r.channel} cap`,
        headline: `${r.channel} spending cap reached`,
        evidence: `${amountText(pack.meters[0], r.spent)} spent through ${r.channel} against a ${amountText(pack.meters[0], r.cap)} cap. Agent and MCP runs pause until the cap changes or the cycle resets.`,
        action: { kind: "limits", label: "Review caps" },
      };
    case "tier_cap":
      return {
        tone: "atRisk",
        trigger: "Plan · monthly spend cap",
        headline: `${r.plan} caps spend at ${money(r.cap)} a month`,
        evidence: `${money(r.spent)} spent this cycle. A higher tier raises the cap.`,
        action: { kind: "plan", label: "Compare tiers" },
      };
    case "subscription_paused":
      return {
        tone: "neutral",
        trigger: "Subscription · paused",
        headline: "Runs are off while the subscription is paused",
        evidence: "Resume to run workflows again. Balances stay where they are.",
        action: { kind: "resume", label: "Resume" },
      };
    case "plan_feature":
      return {
        tone: "info",
        trigger: "Plan · feature",
        headline: `${r.step} needs a plan with ${r.feature.toUpperCase()}`,
        evidence: "The step was skipped; the rest of the run went ahead.",
        action: { kind: "plan", label: "Compare plans" },
      };
    case "spend_limit": {
      const m = meterOf(pack, r.meter);
      const who = r.scope === "workspace" ? "The workspace" : r.scope === "table" ? `${r.target}` : `${r.target}'s`;
      return {
        tone: "watch",
        trigger: `Limits · ${r.scope} limit`,
        headline: r.scope === "member" ? `${who} ${amountText(m, r.limit)} limit is reached` : `${who} reached its ${amountText(m, r.limit)} limit`,
        evidence: `${amountText(m, r.spent)} used this cycle. The limit is set to block, so new rows wait until an admin raises it or the cycle resets. Nothing was charged.`,
        action: { kind: "limits", label: "Review limits" },
      };
    }
    case "payment_overdue":
      return {
        tone: "blocked",
        trigger: "Billing · grace window ended",
        headline: `Runs are paused until the ${money(r.amount)} renewal is paid`,
        evidence: `Credits kept working through the grace window, which ended ${new Date(r.graceEnded).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}. Your data and exports stay available.`,
        action: { kind: "billing", label: "Update payment" },
      };
  }
}

/** One example of every reason, for the gallery and checks. */
export function sampleReasons(pack: TenantPack): BlockReason[] {
  const m = pack.meters[0];
  const big = m.valueType === "currency" ? 12 : 600;
  return [
    { code: "insufficient_balance", meter: m.id, needed: big, available: big / 6 },
    { code: "budget_reached", workflow: pack.demo.hub.dev.workflows[0].name, budget: big * 2, spent: big * 2 },
    { code: "channel_cap", channel: "MCP", cap: big, spent: big },
    { code: "tier_cap", plan: pack.plans[1]?.name ?? pack.plans[0].name, cap: 100, spent: 100 },
    { code: "subscription_paused" },
    { code: "plan_feature", feature: pack.rateCard.find((r) => r.requires)?.requires ?? "crm", step: pack.rateCard.find((r) => r.requires)?.label ?? "CRM auto-sync" },
    { code: "spend_limit", scope: "member", target: "Priya", meter: m.id, limit: big, spent: big },
    { code: "payment_overdue", graceEnded: new Date(Date.UTC(2026, 10, 30)).toISOString(), amount: pack.plans.find((p) => p.paid && p.price)?.price ?? 100 },
  ];
}

