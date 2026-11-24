// 25 help-chat transcripts in which workspaces ask for free credits or discounts, each tagged
// by intent. Built from the simulated population and the Tenant Pack, so the people, plans,
// meters and prices in them are the tenant's own. Deterministic for a seed.
import type { SimConfig, TenantPack } from "@/tenants/schema";
import { addDays, fnv1a, mulberry32 } from "@/core/time";
import { amountText, fmtUsd } from "@/core/format";
import { packsFor, planOf, primaryMeter } from "@/core/pack";
import type { ChatIntent, ChatTicket, WorkspaceSummary } from "@/sim/usage90-types";

const MIX: [ChatIntent, number][] = [
  ["free-credits", 7],
  ["discount", 5],
  ["trial-extension", 3],
  ["refund", 2],
  ["startup-program", 2],
  ["nonprofit-education", 2],
  ["annual-prepay", 2],
  ["regional-pricing", 2],
];

export const CHAT_COUNT = MIX.reduce((s, [, n]) => s + n, 0);

export function helpChats(pack: TenantPack, cfg: SimConfig, ws: WorkspaceSummary[], windowStart: Date): ChatTicket[] {
  const rng = mulberry32(parseInt(fnv1a(`chats:${cfg.seed}`), 16));
  const prim = primaryMeter(pack);
  const paid = (w: WorkspaceSummary) => planOf(pack, w.planId).paid;
  const used = new Set<string>();
  const pool: Record<ChatIntent, (w: WorkspaceSummary) => boolean> = {
    "free-credits": (w) => !paid(w) && w.blocked > 0,
    discount: (w) => paid(w) && w.topUps > 0,
    "trial-extension": (w) => !paid(w) && (w.status === "quiet" || w.status === "never-ran"),
    refund: (w) => w.status === "churned",
    "startup-program": (w) => w.source === "referral" || w.source === "partner",
    "nonprofit-education": (w) => !paid(w) && w.status !== "never-ran",
    "annual-prepay": (w) => paid(w) && w.status === "active",
    "regional-pricing": (w) => w.region === "in",
  };
  const choose = (intent: ChatIntent): WorkspaceSummary => {
    let xs = ws.filter((w) => !used.has(w.id) && pool[intent](w));
    if (!xs.length) xs = ws.filter((w) => !used.has(w.id));
    const w = xs[Math.floor(rng() * xs.length)];
    used.add(w.id);
    return w;
  };
  const one = <T,>(xs: T[]): T => xs[Math.floor(rng() * xs.length)];
  const reward = pack.rewards.find((r) => !r.pending) ?? null;
  const small = packsFor(pack, prim.id)[0] ?? null;
  const enrich = () => one(cfg.enrichments).label.toLowerCase();
  const nextPlan = (w: WorkspaceSummary) => {
    const cur = planOf(pack, w.planId);
    return pack.plans.find((p) => p.paid && !p.proposed && (p.price ?? Infinity) > (cur.price ?? 0) && p.price != null) ?? cur;
  };
  const resetIn = () => 3 + Math.floor(rng() * 20);
  const out: ChatTicket[] = [];
  let n = 0;
  for (const [intent, count] of MIX) {
    for (let k = 0; k < count; k++) {
      const w = choose(intent);
      const plan = planOf(pack, w.planId);
      const up = nextPlan(w);
      // Somewhere in the month before the workspace was last active (or any time in the window).
      const last = Math.min(cfg.days - 1, Math.max(0, w.lastActiveDay ?? cfg.days - 1));
      const lo = Math.max(0, w.signupDay, last - 30);
      const day = Math.min(last, lo + Math.floor(rng() * (last - lo + 1)));
      const opened = addDays(windowStart, day);
      opened.setHours(9 + Math.floor(rng() * 9), Math.floor(rng() * 60), 0, 0);
      let messages: ChatTicket["messages"] = [];
      let outcome = "";
      let signals: string[] = [];
      let sentiment: ChatTicket["sentiment"] = "neutral";
      if (intent === "free-credits") {
        const days = resetIn();
        sentiment = rng() < 0.6 ? "frustrated" : "neutral";
        signals = ["hit-cap", w.blocked > 3 ? "repeat-blocks" : "first-block"];
        const give = rng() < 0.35;
        outcome = give ? "Granted promo credits" : reward ? "Pointed to rewards" : "Suggested the smallest top-up";
        messages = [
          { from: "customer", text: one([`I ran out of ${prim.label} halfway through a ${enrich()} run. Can you add a few free ones so I can finish the list?`, `Is there any way to get some free ${prim.label}? I'm on ${plan.name} and hit the limit again.`]) },
          { from: "agent", text: `I can see ${w.blocked} of your runs were stopped this period because the balance reached zero. Your ${plan.name} allowance comes back in ${days} days.` },
          { from: "customer", text: one(["That's too long, I need it for a call this week.", "Can't you just add a little? It's a small list."]) },
          {
            from: "agent",
            text: give
              ? `I've added ${amountText(prim, prim.valueType === "currency" ? 2 : Math.max(10, Math.round((plan.included[prim.id] ?? 50) * 0.25)))} as promo credit. They're spent first and last 30 days.`
              : reward
                ? `I can't add credits on ${plan.name}, but "${reward.label}" adds ${amountText(prim, reward.amount)} straight away.${small ? ` The smallest top-up is ${amountText(prim, small.units)} for ${fmtUsd(small.price)}.` : ""}`
                : small
                  ? `The smallest top-up is ${amountText(prim, small.units)} for ${fmtUsd(small.price)}, and it's added immediately.`
                  : `Moving to ${up.name} raises the allowance to ${amountText(prim, up.included[prim.id] ?? 0)}.`,
          },
        ];
      } else if (intent === "discount") {
        sentiment = "neutral";
        signals = ["heavy-top-ups", "upgrade-signal"];
        outcome = up.id !== plan.id ? "Recommended a plan change" : "Offered annual prepay";
        messages = [
          { from: "customer", text: one([`We've bought ${w.topUps} top-ups in the last three months. Is there a volume discount?`, `Top-ups are adding up for us. Any discount if we keep buying them?`]) },
          { from: "agent", text: `Top-ups are priced above the plan rate. At your usage, ${up.id !== plan.id ? `${up.name} at ${fmtUsd(up.price ?? 0, 0)} a month includes ${amountText(prim, up.included[prim.id] ?? 0)}` : `an annual commitment on ${plan.name}`} would have cost less than what you paid.` },
          { from: "customer", text: "Can you just give us the plan rate on top-ups instead?" },
          { from: "agent", text: up.id !== plan.id ? `Not on ${plan.name}, but I can switch you now and prorate the difference, so the next run is covered at the lower rate.` : "I've passed this to the account team with your usage; they'll come back with an annual quote." },
        ];
      } else if (intent === "trial-extension") {
        sentiment = rng() < 0.5 ? "neutral" : "frustrated";
        signals = [w.status === "never-ran" ? "never-activated" : "went-quiet"];
        outcome = rng() < 0.5 ? "Extended the trial 14 days" : "Pointed to rewards";
        messages = [
          { from: "customer", text: one([`My free ${prim.label} expired before I had time to test properly. Could you extend the trial?`, `I signed up a while ago but never got round to trying it. Can I get the trial credits again?`]) },
          { from: "agent", text: `No problem. Here's a quick start: run a ${enrich()} on a 20-${pack.workUnit.one} sample first so you see results before spending much.` },
          { from: "agent", text: outcome === "Extended the trial 14 days" ? "I've extended your trial by 14 days." : reward ? `"${reward.label}" also adds ${amountText(prim, reward.amount)}.` : "Your allowance resets at the start of next month." },
        ];
      } else if (intent === "refund") {
        sentiment = "frustrated";
        signals = ["churned", "billing"];
        outcome = rng() < 0.5 ? "Escalated to billing" : "Refunded the last charge";
        messages = [
          { from: "customer", text: `We cancelled ${plan.name} but were still charged ${fmtUsd(plan.price ?? 0, 0)}. Can we get that back?` },
          { from: "agent", text: "I can see the cancellation was scheduled for the end of the period, so that renewal went through. Did you use any credits after it?" },
          { from: "customer", text: "No, nothing since." },
          { from: "agent", text: outcome === "Refunded the last charge" ? "Then I've refunded it in full; it shows on your statement in 5–10 days." : "I've sent it to billing with the usage attached; you'll hear back within two working days." },
        ];
      } else if (intent === "startup-program") {
        signals = ["startup", w.source];
        outcome = "Sent the startup programme form";
        messages = [
          { from: "customer", text: `We're a seed-stage team (found you through a ${w.source === "partner" ? "partner" : "friend"}). Do you have startup credits or a discount?` },
          { from: "agent", text: `Yes — the startup programme gives a first-year discount on paid plans for companies under 3 years old. I've sent the form to your email.` },
        ];
      } else if (intent === "nonprofit-education") {
        sentiment = "positive";
        signals = ["nonprofit"];
        outcome = "Escalated to partnerships";
        messages = [
          { from: "customer", text: one([`I'm teaching a course and want students to use ${pack.company}. Is there an education discount?`, `We're a registered nonprofit. Do you offer reduced pricing?`]) },
          { from: "agent", text: "We review these case by case. I've passed your details to the partnerships team, who'll reply within a week." },
        ];
      } else if (intent === "annual-prepay") {
        sentiment = "positive";
        signals = ["expansion"];
        outcome = "Offered annual prepay";
        messages = [
          { from: "customer", text: `If we pay for ${plan.name} annually instead of monthly, what's the discount?` },
          { from: "agent", text: `Annual prepay on ${plan.name} is two months free, and unused ${prim.label} roll over within the year. I can send the quote now.` },
        ];
      } else {
        sentiment = "neutral";
        signals = ["price-sensitive", "region-in"];
        outcome = rng() < 0.6 ? "Logged as pricing feedback" : "Offered annual prepay";
        messages = [
          { from: "customer", text: `Pricing in dollars is steep for a team in India. Do you have regional pricing?` },
          { from: "agent", text: `Prices are shown in rupees with GST added, but the rates are the same everywhere for now. I've logged your feedback for the pricing team.` },
        ];
      }
      n++;
      out.push({ id: `chat-${String(n).padStart(3, "0")}`, workspaceId: w.id, workspaceName: w.name, planId: w.planId, region: w.region, openedAt: opened.toISOString(), intent, signals, sentiment, outcome, messages });
    }
  }
  return out.sort((a, b) => (a.openedAt < b.openedAt ? 1 : -1));
}
