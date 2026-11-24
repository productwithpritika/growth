// The seeded Growth Knowledge Base the Research Analyst cites (Phase 4 §4.4). Every card is
// illustrative: patterns written for this prototype, not quotes from a real company or study.
import type { Confidence } from "@/growth/types";

export interface KbCard {
  id: string;
  title: string;
  topic: "teardown" | "topups" | "daily" | "rollover" | "free-tier" | "dunning" | "cancel" | "models" | "experiments";
  source: string;
  asOf: string;
  confidence: Confidence;
  body: string;
  tags: string[];
}

export const KB: KbCard[] = [
  { id: "kb-clay", title: "Teardown: two independent meters", topic: "teardown", source: "Chargebee pattern library (illustrative)", asOf: "2026-10", confidence: "medium", body: "Data-plus-platform products price the data they resell and their own compute separately. Users understand 'data costs vary by provider' better than one blended credit, and heavy platform users can expand without buying data they do not need.", tags: ["two meters", "actions", "data credits", "clay", "independent", "packaging", "pricing"] },
  { id: "kb-builderco", title: "Teardown: one credit with daily grants", topic: "teardown", source: "Chargebee pattern library (illustrative)", asOf: "2026-09", confidence: "medium", body: "Single-credit AI builders often grant a few credits a day on free plans and a monthly bundle on paid plans. Daily grants create a habit and cap abuse; the monthly bundle with rollover reduces end-of-month anxiety.", tags: ["daily", "free tier", "builder", "rollover", "single credit"] },
  { id: "kb-apico", title: "Teardown: prepaid balance with usage tiers", topic: "teardown", source: "Chargebee pattern library (illustrative)", asOf: "2026-09", confidence: "medium", body: "API products sell a dollar balance with auto-reload and raise rate limits as cumulative spend grows. Tiers reward commitment without a plan change, and auto-reload removes the hard stop for production traffic.", tags: ["prepaid", "api", "auto-reload", "tiers", "balance"] },
  { id: "kb-topup-size", title: "Top-up ladders: three to four sizes", topic: "topups", source: "Monetization benchmark notes (illustrative)", asOf: "2026-08", confidence: "medium", body: "Three or four pack sizes with a visible per-unit discount convert best. One size forces over-buying; more than five slows the decision. The middle pack is usually chosen when it is labelled with the job it covers.", tags: ["top-up", "packs", "ladder", "pricing", "discount"] },
  { id: "kb-autoreload", title: "Auto top-up design", topic: "topups", source: "Monetization benchmark notes (illustrative)", asOf: "2026-08", confidence: "high", body: "Auto top-up works when the threshold, the amount and a monthly cap are visible at consent time, and when the user is told after every charge. Pre-ticking it at first purchase lifts adoption, but complaints rise if the cap is hidden.", tags: ["auto top-up", "auto-reload", "consent", "cap", "default"] },
  { id: "kb-starter", title: "Starter packs at the limit", topic: "topups", source: "Chargebee customer patterns (illustrative)", asOf: "2026-07", confidence: "medium", body: "Offering a small one-off pack at the free cap converts users who are not ready for a subscription. The pack should cover the job in progress, expire within a month, and point to the plan that would have been cheaper.", tags: ["starter pack", "limit", "free tier", "conversion", "paywall"] },
  { id: "kb-daily-spark", title: "Daily-credit mechanics", topic: "daily", source: "Chargebee pattern library (illustrative)", asOf: "2026-10", confidence: "medium", body: "Small daily grants tied to a qualifying action (not a login) build a habit. Cap them per month, expire them within a week, and limit one wallet per verified domain so they cannot be farmed.", tags: ["daily", "spark", "reward", "habit", "free tier", "abuse"] },
  { id: "kb-rollover", title: "Rollover policies", topic: "rollover", source: "Monetization benchmark notes (illustrative)", asOf: "2026-08", confidence: "high", body: "Capped rollover (one or two months of allowance) is the common middle ground: it removes 'use it or lose it' anxiety without carrying unlimited liability. Saying how much rolls over in plain words matters as much as the cap.", tags: ["rollover", "breakage", "cap", "wording", "expiry"] },
  { id: "kb-breakage", title: "Breakage and revenue recognition", topic: "rollover", source: "Finance practice notes (illustrative)", asOf: "2026-06", confidence: "low", body: "Expected breakage is often recognised in proportion to the pattern of usage rather than at expiry. Treatment depends on the contract and jurisdiction; confirm with finance before funding offers from it.", tags: ["breakage", "finance", "recognition", "accounting", "pool"] },
  { id: "kb-free-tier", title: "Free-tier design for usage-priced AI tools", topic: "free-tier", source: "Chargebee pattern library (illustrative)", asOf: "2026-10", confidence: "medium", body: "The best free tiers let a new user finish one real job. Too small and users never see value; too large and nobody upgrades. A guided first run with a cost estimate cuts the share of users who never start.", tags: ["free tier", "activation", "first run", "estimate", "onboarding", "quiet"] },
  { id: "kb-activation", title: "Activation in the first week", topic: "free-tier", source: "Product analytics notes (illustrative)", asOf: "2026-09", confidence: "medium", body: "Most free users who will ever activate do so in the first three days. A template table and a nudge on day two outperform generic welcome e-mails.", tags: ["activation", "template", "nudge", "first week", "quiet"] },
  { id: "kb-dunning", title: "Dunning benchmarks", topic: "dunning", source: "Chargebee recovery data (illustrative)", asOf: "2026-08", confidence: "medium", body: "Soft declines recover at roughly half with a fixed retry schedule and more with payday-aware retries. Hard declines need the customer: a one-tap card update link and a backup method prompt matter most.", tags: ["dunning", "retry", "failed payment", "involuntary churn", "card"] },
  { id: "kb-grace", title: "Grace periods that keep work running", topic: "dunning", source: "Chargebee recovery data (illustrative)", asOf: "2026-07", confidence: "medium", body: "Letting credits keep working during a short grace period lifts recovery: users who can still run their tables have a reason to fix the card. Pause only after grace ends, and never block data export.", tags: ["grace", "dunning", "soft landing", "recovery"] },
  { id: "kb-cancel", title: "Cancel-flow patterns", topic: "cancel", source: "Retention practice notes (illustrative)", asOf: "2026-09", confidence: "medium", body: "Matched offers beat blanket discounts: pause for 'not using it now', a cheaper plan for 'too expensive', help for 'too hard'. Always offer one, never more than one, and make cancelling one click after the offer.", tags: ["cancel", "save offer", "retention", "pause", "discount"] },
  { id: "kb-winback", title: "Win-back with expiring credits", topic: "cancel", source: "Retention practice notes (illustrative)", asOf: "2026-08", confidence: "low", body: "Reminding quiet users of credits about to expire, with one concrete table to run, brings more back than a discount and costs no margin.", tags: ["win-back", "expiring", "quiet", "credits", "nudge"] },
  { id: "kb-model-default", title: "Default model choice", topic: "models", source: "AI product notes (illustrative)", asOf: "2026-10", confidence: "medium", body: "Most users never change a default model, so the default sets the margin. Move the default only when an eval shows equal quality on the customer's own tasks, and let users opt back.", tags: ["model", "default", "margin", "cost", "eval"] },
  { id: "kb-experiments", title: "Experiment hygiene for pricing tests", topic: "experiments", source: "Experimentation notes (illustrative)", asOf: "2026-09", confidence: "high", body: "Pre-register the metric, keep a holdout, check the sample ratio and read decisions only after a full weekly cycle. Pricing tests on existing customers need a grandfathering policy agreed up front.", tags: ["experiment", "holdout", "sample size", "pricing", "grandfathering"] },
  { id: "kb-annual", title: "Annual upgrade timing", topic: "experiments", source: "Monetization benchmark notes (illustrative)", asOf: "2026-07", confidence: "low", body: "Annual offers land best late in a cycle, when the renewal is visible and the user has seen a month of value. Early-cycle annual nudges tend to underperform.", tags: ["annual", "upgrade", "timing", "discount"] },
];

export function kbById(id: string): KbCard | undefined {
  return KB.find((k) => k.id === id);
}

export function searchKb(q: string, n = 5): KbCard[] {
  const words = q.toLowerCase().split(/[^a-z0-9-]+/).filter((w) => w.length > 2);
  const scored = KB.map((c) => {
    const hay = `${c.title} ${c.tags.join(" ")} ${c.body}`.toLowerCase();
    const s = words.reduce((acc, w) => acc + (c.tags.some((t) => t.includes(w)) ? 3 : 0) + (hay.includes(w) ? 1 : 0), 0);
    return { c, s };
  });
  return scored.filter((x) => x.s > 0).sort((a, b) => b.s - a.s).slice(0, n).map((x) => x.c);
}
