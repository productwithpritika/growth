// Custom portal experiences (Phase 7 §7.4). A merchant, or its agent, describes a moment in plain
// words; this composes a Moment definition, validates it against a schema, evaluates it against a
// real Hub account for the live preview, and publishes it with versions and one-click rollback.
import { z } from "zod";
import type { TenantState } from "@/core/types";
import type { TenantPack } from "@/tenants/schema";
import { cycleOf, fnv1a } from "@/core/time";
import { meterTimeline } from "@/core/forecasting";
import { balanceOf } from "@/core/ledger";
import { monthlyAllowance, planOf } from "@/core";
import type { MomentDef, PortalMoment } from "@/platform/types";

export const MomentDefSchema = z.object({
  id: z.string().regex(/^mom-[a-z0-9]{4,12}$/),
  version: z.number().int().positive(),
  name: z.string().min(3).max(90),
  trigger: z.discriminatedUnion("metric", [
    z.object({ metric: z.literal("forecast_runout_days"), op: z.literal("<"), value: z.number().int().min(1).max(30), meter: z.string() }),
    z.object({ metric: z.literal("balance_pct"), op: z.literal("<"), value: z.number().int().min(1).max(99), meter: z.string() }),
    z.object({ metric: z.literal("payment_failed"), op: z.literal(">"), value: z.literal(0), meter: z.string() }),
    z.object({ metric: z.literal("plan_cap_hit"), op: z.literal(">"), value: z.literal(0), meter: z.string() }),
  ]),
  audience: z.object({ plans: z.array(z.string()).min(1) }),
  blocks: z.array(z.object({ kind: z.enum(["headline", "body"]), text: z.string().min(3).max(160) })).min(1),
  primaryAction: z.object({ label: z.string().min(2).max(30), action: z.enum(["open-topups", "open-plan", "open-billing", "open-usage"]) }),
  frequencyCap: z.object({ count: z.number().int().min(1).max(10), per: z.enum(["day", "week", "month"]) }),
  experiment: z.object({ enabled: z.boolean(), holdout: z.number().min(0).max(0.5) }),
  locales: z.array(z.string().regex(/^[a-z]{2}-[A-Z]{2}$/)).min(1),
  tone: z.enum(["watch", "info", "reward", "atRisk"]),
});

export interface Composed {
  def: MomentDef | null;
  errors: string[];
  notes: string[];
}

const LOCALES: [RegExp, string][] = [
  [/\bfrench\b/, "fr-FR"],
  [/\bgerman\b/, "de-DE"],
  [/\bspanish\b/, "es-ES"],
  [/\bjapanese\b/, "ja-JP"],
  [/\bhindi\b/, "hi-IN"],
  [/\bbritish\b|\buk english\b/, "en-GB"],
];

const ACTIONS = {
  "open-topups": "Top up now",
  "open-plan": "See plans",
  "open-billing": "Update card",
  "open-usage": "See usage",
} as const;

/** Compose a Moment definition from plain words. Anything it can't place is reported, never guessed silently. */
export function composeMoment(pack: TenantPack, prompt: string, prev?: MomentDef): Composed {
  const q = prompt.toLowerCase();
  const errors: string[] = [];
  const notes: string[] = [];
  const meter = pack.meters.find((m) => q.includes(m.label.toLowerCase())) ?? pack.meters[0];
  const plans = pack.plans.filter((p) => !p.proposed && new RegExp(`\\b${p.name.toLowerCase()}\\b`).test(q)).map((p) => p.id);
  if (!plans.length) {
    if (/\bpaid\b/.test(q)) plans.push(...pack.plans.filter((p) => p.paid && !p.proposed).map((p) => p.id));
    else {
      plans.push(...pack.plans.filter((p) => !p.proposed).map((p) => p.id));
      notes.push("No plan named, so every plan is in the audience.");
    }
  }
  let trigger: MomentDef["trigger"] | null = null;
  const runout = q.match(/run[- ]?out[^0-9]{0,30}(\d{1,2})\s*days?/) ?? q.match(/(?:under|below|less than|within)\s*(\d{1,2})\s*days?/);
  const pctm = q.match(/balance[^0-9]{0,30}(\d{1,2})\s*%/) ?? q.match(/(\d{1,2})\s*%\s*(?:left|remaining)/);
  if (runout) trigger = { metric: "forecast_runout_days", op: "<", value: Number(runout[1]), meter: meter.id };
  else if (pctm) trigger = { metric: "balance_pct", op: "<", value: Number(pctm[1]), meter: meter.id };
  else if (/payment (?:fails|failed|failure)|card (?:fails|is declined|declined)|failed payment/.test(q)) trigger = { metric: "payment_failed", op: ">", value: 0, meter: meter.id };
  else if (/(?:hit|hits|reach|reaches)\s+(?:the |their )?(?:cap|limit)|run out of|out of credits/.test(q)) trigger = { metric: "plan_cap_hit", op: ">", value: 0, meter: meter.id };
  if (!trigger) errors.push('No trigger found. Say when it shows, for example "when forecast run-out is under 5 days" or "when the balance is below 20%".');
  let cap: MomentDef["frequencyCap"] = { count: 1, per: "week" };
  const fm = q.match(/(once|twice|(\d)\s*times?)\s*(?:a|per|every)\s*(day|week|month)/) ?? q.match(/\b(daily|weekly|monthly)\b/);
  if (fm) {
    if (fm[1] === "daily" || fm[1] === "weekly" || fm[1] === "monthly") cap = { count: 1, per: fm[1] === "daily" ? "day" : fm[1] === "weekly" ? "week" : "month" };
    else cap = { count: fm[1] === "once" ? 1 : fm[1] === "twice" ? 2 : Number(fm[2]), per: fm[3] as "day" | "week" | "month" };
  } else notes.push("No frequency given: capped at once a week.");
  const action: MomentDef["primaryAction"]["action"] = /top[- ]?up|buy (?:more )?credits/.test(q) ? "open-topups" : /upgrade|\bplan\b/.test(q) ? "open-plan" : /card|billing|payment/.test(q) ? "open-billing" : "open-usage";
  const locales = ["en-US", ...LOCALES.filter(([r]) => r.test(q)).map(([, l]) => l)];
  const experiment = /experiment|a\/b|holdout|test it/.test(q);
  if (/\b(grant|give|refund|discount|delete|cancel)\b/.test(q)) notes.push("Moments only show content and link to an action. Grants, refunds and discounts are separate tools that need their own approval, so that part was not added.");
  if (!trigger) return { def: null, errors, notes };
  const planNames = plans.map((id) => planOf(pack, id).name);
  const audience = planNames.length === pack.plans.filter((p) => !p.proposed).length ? "everyone" : planNames.join(" and ");
  const headline =
    trigger.metric === "forecast_runout_days"
      ? `You'll run out of ${meter.label} in about {days} days`
      : trigger.metric === "balance_pct"
        ? `{pct} of your ${meter.label} left`
        : trigger.metric === "payment_failed"
          ? "Your last payment didn't go through"
          : `You've used all your ${meter.label} for this cycle`;
  const body =
    action === "open-topups"
      ? "At your current pace. Top up now and scheduled runs keep going; unused top-up credits roll over."
      : action === "open-plan"
        ? "A bigger plan includes more each month and costs less per credit than repeated top-ups."
        : action === "open-billing"
          ? "Runs keep working during the grace window. Update the card to avoid a pause."
          : "See what used them and what is scheduled next.";
  const what = action === "open-topups" ? "Top-up" : action === "open-plan" ? "Upgrade" : action === "open-billing" ? "Billing" : "Usage";
  const when = trigger.metric === "forecast_runout_days" ? `run-out under ${trigger.value} days` : trigger.metric === "balance_pct" ? `balance under ${trigger.value}%` : trigger.metric === "payment_failed" ? "payment failed" : "cap reached";
  const def: MomentDef = {
    id: prev?.id ?? `mom-${fnv1a(`${pack.id}|${prompt}`).slice(0, 6)}`,
    version: prev ? prev.version + 1 : 1,
    name: `${what} moment · ${audience} · ${when}`.slice(0, 90),
    trigger,
    audience: { plans },
    blocks: [
      { kind: "headline", text: headline },
      { kind: "body", text: body },
    ],
    primaryAction: { label: ACTIONS[action], action },
    frequencyCap: cap,
    experiment: { enabled: experiment, holdout: experiment ? 0.1 : 0 },
    locales: [...new Set(locales)],
    tone: trigger.metric === "payment_failed" ? "atRisk" : trigger.metric === "plan_cap_hit" ? "info" : "watch",
  };
  const v = MomentDefSchema.safeParse(def);
  if (!v.success) return { def, errors: v.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`), notes };
  return { def, errors: [], notes };
}

export function validateMoment(def: unknown, pack: TenantPack): string[] {
  const v = MomentDefSchema.safeParse(def);
  const out = v.success ? [] : v.error.issues.map((i) => `${i.path.join(".") || "moment"}: ${i.message}`);
  if (v.success) {
    for (const p of v.data.audience.plans) if (!pack.plans.some((x) => x.id === p)) out.push(`audience.plans: unknown plan "${p}"`);
    if (!pack.meters.some((m) => m.id === v.data.trigger.meter)) out.push(`trigger.meter: unknown meter "${v.data.trigger.meter}"`);
  }
  return out;
}

/** The moment in plain words, shown next to the JSON. */
export function summarise(pack: TenantPack, d: MomentDef): string {
  const plans = d.audience.plans.map((id) => planOf(pack, id).name).join(", ");
  const meter = pack.meters.find((m) => m.id === d.trigger.meter)?.label ?? d.trigger.meter;
  const when =
    d.trigger.metric === "forecast_runout_days"
      ? `their ${meter} forecast runs out in under ${d.trigger.value} days`
      : d.trigger.metric === "balance_pct"
        ? `their ${meter} balance is under ${d.trigger.value}% of the allowance`
        : d.trigger.metric === "payment_failed"
          ? "a payment fails"
          : `they have used all their ${meter}`;
  const freq = `${d.frequencyCap.count === 1 ? "once" : d.frequencyCap.count === 2 ? "twice" : `${d.frequencyCap.count} times`} a ${d.frequencyCap.per}`;
  return `Shows a card to ${plans} workspaces when ${when}, at most ${freq}. Primary action: ${d.primaryAction.label}. Locales: ${d.locales.join(", ")}. ${d.experiment.enabled ? `Runs as an experiment with a ${Math.round(d.experiment.holdout * 100)}% holdout.` : "Not part of an experiment."} Version ${d.version}.`;
}

export interface MomentEval {
  audience: boolean;
  fires: boolean;
  value: number | null;
  reason: string;
  headline: string;
}

/** Evaluate a moment for one Hub account right now: is it in the audience, does the trigger hold, and the filled-in headline. */
export function evaluateMoment(t: TenantState, d: MomentDef, account: "maya" | "dev"): MomentEval {
  const hub = t.hub[account];
  const plan = planOf(t.pack, hub.planId);
  const audience = d.audience.plans.includes(hub.planId);
  const meter = t.pack.meters.find((m) => m.id === d.trigger.meter) ?? t.pack.meters[0];
  let fires = false;
  let value: number | null = null;
  let reason = "";
  let headline = d.blocks.find((b) => b.kind === "headline")?.text ?? d.name;
  if (d.trigger.metric === "forecast_runout_days") {
    const tl = meterTimeline(t, account, meter.id);
    const { day } = cycleOf(t);
    const left = tl.ranOutAt ? 0 : tl.runsOutDay != null ? Math.max(0, tl.runsOutDay - day) : null;
    value = left;
    fires = left != null && left < d.trigger.value;
    reason = left == null ? `${meter.label} last the cycle at the current pace.` : `Forecast run-out in ${left} day${left === 1 ? "" : "s"} (trigger: under ${d.trigger.value}).`;
    headline = headline.replace("{days}", left == null ? "—" : String(Math.max(1, left)));
  } else if (d.trigger.metric === "balance_pct") {
    const allowance = Math.max(1, monthlyAllowance(t.pack, hub.planId, meter.id));
    const pct = Math.round((Math.max(0, balanceOf(t.ledger, account, meter.id)) / allowance) * 100);
    value = pct;
    fires = pct < d.trigger.value;
    reason = `${pct}% of the ${meter.label} allowance left (trigger: under ${d.trigger.value}%).`;
    headline = headline.replace("{pct}", `${pct}%`);
  } else if (d.trigger.metric === "payment_failed") {
    fires = hub.dunning.status === "grace" || hub.dunning.status === "suspended";
    reason = fires ? "The renewal payment failed." : "Payments are healthy.";
  } else {
    const bal = balanceOf(t.ledger, account, meter.id);
    value = bal;
    fires = bal <= 0;
    reason = fires ? `${meter.label} are at zero.` : `${Math.round(bal).toLocaleString("en-US")} ${meter.label} left.`;
  }
  if (!audience) reason = `${plan.name} is not in the audience. ${reason}`;
  return { audience, fires: audience && fires, value, reason, headline };
}

/** The frequency-cap window a dismissal covers: a new window shows the moment again. */
export function capWindow(d: MomentDef, clockIso: string): string {
  const day = Math.floor(new Date(clockIso).getTime() / 86_400_000);
  const span = d.frequencyCap.per === "day" ? 1 : d.frequencyCap.per === "week" ? 7 : 30;
  return `custom:${d.id}:v${d.version}:${Math.floor(day / span)}`;
}

export const liveDef = (m: PortalMoment): MomentDef | null => (m.live == null ? null : m.versions.find((v) => v.version === m.live) ?? null);
export const latestDef = (m: PortalMoment): MomentDef => m.versions[m.versions.length - 1];

export const EXAMPLE_PROMPT = "Show a top-up banner to Growth users when forecast run-out is under 10 days, once per week";
