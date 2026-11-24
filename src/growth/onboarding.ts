// Agentic onboarding (Phase 3): consent, seven ingestion lanes with real progress over the
// tenant's own (simulated) data, Memory cards, at most five clarifying questions, and the WOW
// reveal. The engine is pure: `tickOnboarding` advances simulated seconds and returns the new
// state plus what happened, so the clock, the lanes and the tests all agree.
import type { TenantState } from "@/core/types";
import type { RegionPack } from "@/tenants/region-schema";
import type { ConnectorState, LaneId, LaneRun, LaneStatus, MemoryCard, OnboardingState, QuestionState, SourceId } from "@/growth/types";
import { growthSim, regionName, scaleOf, segmentById, sourceName } from "@/growth/population";
import { CHAT_INTENTS } from "@/sim/usage90-types";
import { amountText, fmtNum, fmtPct, fmtUsd } from "@/core/format";
import { freePlan, packsFor, planOf, primaryMeter, secondaryMeter, hasSecondary } from "@/core/pack";

type Ctx = Pick<TenantState, "pack" | "population" | "clock"> & { growth?: { anchor: string } };
export interface Env {
  regions: RegionPack[];
}

// ------------------------------------------------------------------ sources and consent

export interface SourceDef {
  id: SourceId;
  name: string;
  kind: "native" | "connector";
  why: string;
  reads: string;
  stores: string;
  retention: string;
  scopes: string;
  minimum: boolean;
  withoutIt: string;
}

export const SOURCES: SourceDef[] = [
  {
    id: "billing",
    name: "Chargebee subscriptions, invoices and customers",
    kind: "native",
    why: "Plans, prices, revenue movements and where customers are billed.",
    reads: "Subscriptions, invoices, plan catalog, customer country",
    stores: "Aggregates by plan, region and cohort. Customer ids are hashed; no names or e-mail addresses are kept.",
    retention: "13 months, then aggregates only",
    scopes: "subscriptions:read, invoices:read, catalog:read",
    minimum: true,
    withoutIt: "I won't know your plans, revenue or where customers are billed, so findings about pricing and churn are off.",
  },
  {
    id: "usage",
    name: "Chargebee usage events and credit ledger",
    kind: "native",
    why: "Which features and models spend which credits, and how each workspace behaves over time.",
    reads: "Metered usage events, ledger entries, holds and top-ups",
    stores: "Daily totals per workspace and feature. Row contents of tables are never read.",
    retention: "13 months",
    scopes: "usage:read, ledger:read",
    minimum: true,
    withoutIt: "I won't see feature usage, model choice or behaviour patterns.",
  },
  {
    id: "policy",
    name: "Chargebee regional policy library",
    kind: "native",
    why: "Tax display, strong authentication, recurring-payment consent and auto-renewal rules for each region you bill in.",
    reads: "Region packs for the countries on your invoices",
    stores: "Which rule set applies to which region.",
    retention: "While connected",
    scopes: "policy:read",
    minimum: true,
    withoutIt: "I won't check offers and experiments against regional billing rules.",
  },
  {
    id: "providers",
    name: "Provider cost feed",
    kind: "connector",
    why: "Your real cost to serve per model and data provider, instead of rate-card list costs.",
    reads: "Monthly provider invoices (model and data vendors)",
    stores: "Cost per provider per month.",
    retention: "13 months",
    scopes: "Read-only invoice export",
    minimum: false,
    withoutIt: "I'll use your rate-card costs, so margin per model is an estimate.",
  },
  {
    id: "analytics",
    name: "Product analytics",
    kind: "connector",
    why: "Which product actions lead to credits being spent, beyond what billing sees.",
    reads: "Product events: tables created, templates opened, schedules set",
    stores: "Event counts per workspace per day. No raw personal data leaves your tenant.",
    retention: "90 days",
    scopes: "Read-only event export",
    minimum: false,
    withoutIt: "Behaviour patterns come from usage events only; product actions that spend nothing stay invisible.",
  },
  {
    id: "helpchat",
    name: "Help chat",
    kind: "connector",
    why: "Requests for free credits or discounts, clustered by reason.",
    reads: "Conversation tags and the first customer message",
    stores: "Request counts by reason. Message text is summarised and then discarded.",
    retention: "90 days",
    scopes: "conversations:read (tags only)",
    minimum: false,
    withoutIt: "I won't know what customers ask support for, so discount and free-credit demand is off.",
  },
];

export const sourceDef = (id: SourceId) => SOURCES.find((s) => s.id === id)!;

export function residency(t: Ctx): string {
  return t.pack.regions[0]?.residency ?? "Your tenant's region";
}

// ------------------------------------------------------------------ lanes

export interface LaneDef {
  id: LaneId;
  title: string;
  needs: SourceId[];
  enrichedBy: SourceId[];
  startAt: number;
  read: number;
  understand: number;
  unit: string;
}

export const LANES: LaneDef[] = [
  { id: "policy", title: "Regional billing rules and policies", needs: ["policy", "billing"], enrichedBy: [], startAt: 0, read: 14, understand: 16, unit: "rules" },
  { id: "customers", title: "Customer data and profile", needs: ["billing"], enrichedBy: [], startAt: 0, read: 34, understand: 26, unit: "workspaces" },
  { id: "pricing", title: "Pricing information", needs: ["billing"], enrichedBy: [], startAt: 2, read: 12, understand: 20, unit: "catalog items" },
  { id: "features", title: "Feature usage mapped to credits", needs: ["usage"], enrichedBy: ["analytics"], startAt: 6, read: 38, understand: 24, unit: "runs" },
  { id: "models", title: "Model and provider usage against price", needs: ["usage"], enrichedBy: ["providers"], startAt: 10, read: 26, understand: 24, unit: "model runs" },
  { id: "behaviour", title: "Behaviour patterns", needs: ["usage", "billing"], enrichedBy: ["analytics"], startAt: 14, read: 44, understand: 40, unit: "workspace-days" },
  { id: "helpchat", title: "Help-chat signals", needs: ["helpchat"], enrichedBy: [], startAt: 0, read: 20, understand: 24, unit: "conversations" },
];

export const laneDef = (id: LaneId) => LANES.find((l) => l.id === id)!;

const CONNECT_SECONDS = 14;
const SLOW_SECONDS = 150;
const FAIL_AT = 9;

export function laneTotal(t: Ctx, id: LaneId): number {
  const sim = growthSim(t);
  const k = scaleOf(t.pack);
  switch (id) {
    case "policy":
      return Math.max(1, new Set(sim.workspaces.map((w) => w.region)).size) * 4;
    case "customers":
      return sim.workspaces.length * k;
    case "pricing":
      return t.pack.plans.length + t.pack.meters.length + t.pack.grantRules.length + t.pack.topUpPacks.length;
    case "features":
      return sim.totals.runs * k;
    case "models":
      return sim.models.reduce((s, m) => s + m.runs, 0) * k;
    case "behaviour":
      return sim.workspaces.length * sim.config.days * k;
    case "helpchat":
      return sim.chats.length * k;
  }
}

// ------------------------------------------------------------------ memory cards

type CardDraft = Omit<MemoryCard, "updatedAt" | "edited" | "forgotten" | "history">;

const SRC = {
  billing: "Chargebee subscriptions and invoices",
  usage: "Chargebee usage events",
  policy: "Chargebee policy library",
  providers: "Provider cost feed",
  rate: "Tenant rate card",
  analytics: "Product analytics",
  helpchat: "Help chat",
};

/** What each lane learns, in the order it learns it. Every value is computed from the tenant's data. */
export function laneCards(t: Ctx, lane: LaneId, env: Env, o: OnboardingState): CardDraft[] {
  const pack = t.pack;
  const sim = growthSim(t);
  const k = scaleOf(pack);
  const prim = primaryMeter(pack);
  const share = (f: (w: (typeof sim.workspaces)[number]) => boolean) => sim.workspaces.filter(f).length / Math.max(1, sim.workspaces.length);
  switch (lane) {
    case "policy": {
      const ids = [...new Set(sim.workspaces.map((w) => w.region))].sort();
      const cards: CardDraft[] = [
        {
          id: "policy-regions",
          lane,
          title: "Regions billed",
          value: ids.map((r) => `${regionName(r)} ${fmtPct(share((w) => w.region === r))}`).join(", "),
          source: `${SRC.billing} + ${SRC.policy}`,
          confidence: "high",
        },
      ];
      for (const r of ids) {
        const rp = env.regions.find((x) => x.id === r);
        if (!rp) continue;
        cards.push({
          id: `policy-${r}`,
          lane,
          title: `${rp.shortName} billing rules`,
          value: `${rp.tax.name} ${rp.tax.display === "inclusive" ? "included in prices" : "added on top"}; ${rp.strongAuth.required ? `${rp.strongAuth.method === "3ds" ? "3-D Secure" : "one-time password"} on card payments` : "no strong authentication"}; ${rp.recurring.consentRequired ? "consent before automatic top-ups" : "no extra consent for top-ups"}.`,
          source: SRC.policy,
          confidence: "high",
        });
      }
      if (o.drills.includes("no-policy-region")) cards.push({ id: "policy-br", lane, title: "Brazil", value: "3 invoices billed in BRL. No regional policy pack for Brazil yet.", source: SRC.billing, confidence: "low" });
      return cards;
    }
    case "customers": {
      const paid = sim.workspaces.filter((w) => planOf(pack, w.planId).paid);
      const topSource = Object.entries(sim.config.sources).sort((a, b) => b[1] - a[1])[0];
      const young = share((w) => sim.config.days - 1 - w.signupDay < 30);
      return [
        { id: "customers-size", lane, title: "Customer base", value: `${fmtNum(sim.workspaces.length * k)} workspaces; ${fmtNum(paid.length * k)} paid (${fmtPct(paid.length / Math.max(1, sim.workspaces.length))}).`, source: SRC.billing, confidence: "high" },
        { id: "customers-sources", lane, title: "Acquisition", value: `${sourceName(topSource[0])} brings the most signups (${fmtPct(topSource[1])}); referral and partner signups activate best.`, source: SRC.billing, confidence: "medium" },
        { id: "customers-age", lane, title: "Account age", value: `${fmtPct(young)} of workspaces are under 30 days old.`, source: SRC.billing, confidence: "high" },
      ];
    }
    case "pricing": {
      const plans = pack.plans.map((p) => `${p.name} ${p.price == null ? "custom" : fmtUsd(p.price, 0)}${p.proposed ? " (proposed)" : ""}`).join(", ");
      const rolled = pack.grantRules.filter((g) => g.rollover.mode !== "none").map((g) => `${pack.meters.find((m) => m.id === g.meter)?.label ?? g.meter} ${g.rollover.mode === "full" ? "roll over in full" : `roll over up to ${g.rollover.capX}×`}${g.plan === "*" ? "" : ` on ${planOf(pack, g.plan).name}`}`);
      const packs = pack.meters.map((m) => `${m.label}: ${packsFor(pack, m.id).length} packs`).join("; ");
      const q = o.questions.find((x) => x.id === "q-plan");
      const proposed = pack.plans.find((p) => p.proposed);
      return [
        {
          id: "pricing-plans",
          lane,
          title: "Plans",
          value: q?.status === "answered" && proposed ? `${plans}. ${proposed.name} ${q.answer === "proposal" ? "is a proposal, not live" : "is live"}.` : plans,
          source: q?.status === "answered" ? "Answered by you" : SRC.billing,
          confidence: q?.status === "answered" ? "high" : proposed ? "low" : "high",
        },
        {
          id: "pricing-meters",
          lane,
          title: "Meters",
          value: hasSecondary(pack) ? `Two independent meters: ${prim.label} and ${secondaryMeter(pack).label}.` : `One meter: ${prim.label}.`,
          source: SRC.billing,
          confidence: "high",
        },
        { id: "pricing-rollover", lane, title: "Rollover", value: rolled.length ? `${rolled.join("; ")}. Everything else expires at cycle end.` : "Nothing rolls over.", source: SRC.billing, confidence: "high" },
        { id: "pricing-topups", lane, title: "Top-up packs", value: packs, source: SRC.billing, confidence: "high" },
      ];
    }
    case "features": {
      const byStep = pack.rateCard.map((r) => {
        const costs = Object.entries(r.costs).filter(([, v]) => v > 0).map(([m]) => pack.meters.find((x) => x.id === m)?.label ?? m);
        return { label: r.label, costs };
      });
      const both = byStep.filter((s) => s.costs.length > 1).map((s) => s.label);
      const secOnly = byStep.filter((s) => s.costs.length === 1 && hasSecondary(pack) && s.costs[0] === secondaryMeter(pack).label).map((s) => s.label);
      const q = o.questions.find((x) => x.id === "q-meter");
      const top = [...sim.config.enrichments].sort((a, b) => b.share - a.share)[0];
      const partial = o.connectors.analytics === "partial";
      return [
        {
          id: "features-split",
          lane,
          title: "What spends what",
          value: hasSecondary(pack) ? `${both.length} features spend both meters; ${secOnly.join(", ") || "none"} spend ${secondaryMeter(pack).label} only.` : `Every feature spends ${prim.label}.`,
          source: SRC.rate,
          confidence: "high",
        },
        { id: "features-top", lane, title: "Most used", value: `${top.label} is ${fmtPct(top.share)} of runs.`, source: o.sources.analytics && !partial ? `${SRC.usage} + ${SRC.analytics}` : SRC.usage, confidence: partial ? "medium" : "high" },
        {
          id: "features-primary",
          lane,
          title: "Main value metric",
          value: q?.status === "answered" ? `Experiments read ${q.answer}.` : `Assumed ${prim.label}: it carries most of the revenue.`,
          source: q?.status === "answered" ? "Answered by you" : SRC.usage,
          confidence: q?.status === "answered" ? "high" : "low",
        },
      ];
    }
    case "models": {
      const def = sim.models.filter((m) => m.isDefault).sort((a, b) => b.providerCost - a.providerCost)[0];
      const cheap = sim.models.filter((m) => !m.isDefault && m.enrichment === def?.enrichment).sort((a, b) => a.providerCost / Math.max(1, a.runs) - b.providerCost / Math.max(1, b.runs))[0];
      const name = (id: string) => pack.models.find((m) => m.id === id)?.name ?? id;
      const providers = o.sources.providers && o.connectors.providers === "connected";
      return [
        {
          id: "models-default",
          lane,
          title: "Default model",
          value: def ? `${fmtPct(sim.totals.defaultModelShare)} of model-choice runs stay on the default, ${name(def.model)}, the costliest option at ${fmtUsd(def.providerCost / Math.max(1, def.runs), 3)} a run.` : "No model choice in this product.",
          source: providers ? `${SRC.usage} + ${SRC.providers}` : `${SRC.usage} + ${SRC.rate}`,
          confidence: providers ? "high" : "medium",
        },
        ...(cheap && def
          ? [{ id: "models-cheaper", lane, title: "Cheaper option", value: `${name(cheap.model)} costs ${fmtUsd(cheap.providerCost / Math.max(1, cheap.runs), 3)} a run on the same work.`, source: providers ? SRC.providers : SRC.rate, confidence: (providers ? "high" : "medium") as MemoryCard["confidence"] }]
          : []),
        { id: "models-cost", lane, title: "Cost to serve", value: `${fmtUsd((sim.totals.providerCost / 3) * k, 0)} a month in provider cost against ${fmtUsd(((sim.totals.subsRevenue + sim.totals.topUpRevenue) / 3) * k, 0)} revenue.`, source: providers ? SRC.providers : SRC.rate, confidence: providers ? "high" : "medium" },
      ];
    }
    case "behaviour": {
      const b = sim.config.behaviours;
      const q = o.questions.find((x) => x.id === "q-quiet");
      const quietDays = q?.status === "answered" ? Number(q.answer) : pack.hub.nudges.quietDays;
      const s = segmentById(t, "free-quiet");
      const partial = o.connectors.analytics === "partial";
      const src = o.sources.analytics && o.connectors.analytics !== "failed" && o.connectors.analytics !== "fallback" ? `${SRC.usage} + ${SRC.analytics}` : SRC.usage;
      return [
        { id: "behaviour-churn3", lane, title: "Leave around month three", value: `${fmtPct(b.churnAfter3Months)} of paid workspaces leave after about three months.`, source: SRC.billing, confidence: "high" },
        { id: "behaviour-topups", lane, title: "Add top-ups", value: `${fmtPct(sim.totals.topUpBuyers / Math.max(1, sim.totals.paid))} of paid workspaces bought a top-up in 90 days.`, source: SRC.usage, confidence: "high" },
        { id: "behaviour-switch", lane, title: "Switch models", value: `${fmtPct(b.switchModels)} switch models; ${fmtPct(b.stayOnDefault)} stay on defaults.`, source: SRC.usage, confidence: "high" },
        { id: "behaviour-quiet", lane, title: "Free users go quiet", value: `Quiet means ${quietDays} days without a run. ${s ? s.drivers[1] : ""}.`, source: q?.status === "answered" ? "Answered by you" : src, confidence: q?.status === "answered" ? "high" : partial ? "low" : "medium" },
        { id: "behaviour-never", lane, title: "Never run an enrichment", value: `${fmtPct(sim.totals.neverRan / Math.max(1, sim.workspaces.filter((w) => !planOf(pack, w.planId).paid).length))} of free workspaces never ran an enrichment.`, source: src, confidence: partial ? "medium" : "high" },
      ];
    }
    case "helpchat": {
      const by = CHAT_INTENTS.map((i) => ({ ...i, n: sim.chats.filter((c) => c.intent === i.id).length * k })).filter((x) => x.n > 0).sort((a, b) => b.n - a.n);
      const q = o.questions.find((x) => x.id === "q-chat");
      const disc = sim.chats.filter((c) => c.intent === "discount" || c.intent === "free-credits").length * k;
      return [
        { id: "helpchat-clusters", lane, title: "What people ask for", value: `${fmtNum(sim.chats.length * k)} requests in 90 days: ${by.slice(0, 4).map((x) => `${x.label.toLowerCase()} ${x.n}`).join(", ")}.`, source: SRC.helpchat, confidence: "medium" },
        { id: "helpchat-discount", lane, title: "Discount demand", value: `${disc} ask for free credits or a discount${q?.status === "answered" ? (q.answer === "discount" ? ", including startup-programme requests" : "; startup-programme requests are tracked separately") : ""}.`, source: q?.status === "answered" ? "Answered by you" : SRC.helpchat, confidence: q?.status === "answered" ? "high" : "medium" },
      ];
    }
  }
}

// ------------------------------------------------------------------ clarifying questions

export interface QuestionDef {
  id: string;
  lane: LaneId;
  ask: (t: Ctx, o: OnboardingState) => string | null;
  options: { label: string; value: string }[] | ((t: Ctx) => { label: string; value: string }[]);
  card: string;
}

export const QUESTIONS: QuestionDef[] = [
  {
    id: "q-policy",
    lane: "policy",
    ask: (_t, o) =>
      o.drills.includes("no-policy-region")
        ? "I found 3 invoices billed in Brazil and have no policy pack for Brazil. Should I keep Brazil out of experiments and offers until one exists?"
        : "Your EU price list shows VAT-inclusive prices, but 4 EU invoices in the last 90 days were issued without VAT (reverse charge). Which should offers and experiments follow?",
    options: (t) => [
      { label: "Inclusive; reverse charge only with a VAT ID", value: "inclusive" },
      { label: "Exclusive for everyone", value: "exclusive" },
      ...(t.pack.regions.length ? [] : []),
    ],
    card: "policy-eu",
  },
  {
    id: "q-plan",
    lane: "pricing",
    ask: (t) => {
      const p = t.pack.plans.find((x) => x.proposed);
      const live = t.pack.plans.find((x) => x.paid && !x.proposed && x.price != null);
      return p ? `I see ${p.name} (${p.price == null ? "custom" : fmtUsd(p.price, 0)}) in your catalog with no subscribers, next to ${live?.name ?? "your entry plan"}. Should I treat ${p.name} as a proposal rather than a live plan?` : null;
    },
    options: [
      { label: "Yes, it's a proposal", value: "proposal" },
      { label: "No, it's live", value: "live" },
    ],
    card: "pricing-plans",
  },
  {
    id: "q-meter",
    lane: "features",
    ask: (t) => (hasSecondary(t.pack) ? `Which meter should experiments treat as the main value metric?` : null),
    options: (t) => [
      { label: primaryMeter(t.pack).label, value: primaryMeter(t.pack).label },
      { label: secondaryMeter(t.pack).label, value: secondaryMeter(t.pack).label },
      { label: "Both, separately", value: "both meters separately" },
    ],
    card: "features-primary",
  },
  {
    id: "q-quiet",
    lane: "behaviour",
    ask: (t) => `How many days without a run should count as "quiet" for a ${freePlan(t.pack)?.name ?? "free"} user?`,
    options: [
      { label: "7 days", value: "7" },
      { label: "14 days", value: "14" },
      { label: "21 days", value: "21" },
    ],
    card: "behaviour-quiet",
  },
  {
    id: "q-chat",
    lane: "helpchat",
    ask: (t) => {
      const sim = growthSim(t);
      const n = sim.chats.filter((c) => c.intent === "startup-program").length * scaleOf(t.pack);
      return n ? `${fmtNum(n)} help-chat requests mention a startup programme. Count them as discount requests, or track them as a separate programme?` : null;
    },
    options: [
      { label: "Count as discount requests", value: "discount" },
      { label: "Track separately", value: "separate" },
    ],
    card: "helpchat-discount",
  },
];

export function questionOptions(t: Ctx, q: QuestionDef) {
  return typeof q.options === "function" ? q.options(t) : q.options;
}

// ------------------------------------------------------------------ state

export function initialOnboarding(session: string): OnboardingState {
  return {
    stage: "consent",
    sessionId: session,
    sources: { billing: true, usage: true, policy: true, providers: false, analytics: false, helpchat: false },
    connectors: { billing: "native", usage: "native", policy: "native", providers: "off", analytics: "off", helpchat: "off" },
    lanes: LANES.map((l) => ({ id: l.id, status: "queued", progress: 0, count: 0, chips: [], note: null, partial: false, startedAt: null, doneAt: null })),
    simSeconds: 0,
    connectedAt: null,
    questions: QUESTIONS.map((q) => ({ id: q.id, lane: q.lane, status: "waiting", answer: null, at: null })),
    drills: [],
    speed: 6,
    paused: false,
    revealSeenAt: null,
    realSince: null,
    firstExperimentAt: null,
    firstExperimentId: null,
  };
}

/** Start ingestion with the sources the user consented to. Native sources appear at once; connectors begin connecting. */
export function connect(o: OnboardingState, at: string): OnboardingState {
  const connectors = { ...o.connectors };
  for (const s of SOURCES) connectors[s.id] = !o.sources[s.id] ? "off" : s.kind === "native" ? "native" : "connecting";
  return { ...o, stage: "ingest", connectors, connectedAt: at, simSeconds: 0, lanes: initialOnboarding(o.sessionId).lanes, questions: initialOnboarding(o.sessionId).questions };
}

const sourceReady = (o: OnboardingState, s: SourceId) => {
  const c = o.connectors[s];
  return c === "native" || c === "connected" || c === "partial";
};
const sourceDead = (o: OnboardingState, s: SourceId) => {
  const c = o.connectors[s];
  return c === "off" || c === "failed" || c === "fallback" || c === "forgotten";
};

export interface TickEvent {
  kind: "lane" | "connector" | "question" | "card";
  name: string;
  detail: string;
}

/** Advance onboarding by `dt` simulated seconds. Returns the new state, new Memory cards and events to log. */
export function tickOnboarding(t: Ctx, o0: OnboardingState, dt: number, env: Env, maxQuestions = 5): { o: OnboardingState; cards: CardDraft[]; events: TickEvent[] } {
  if (o0.stage !== "ingest" || o0.paused) return { o: o0, cards: [], events: [] };
  const events: TickEvent[] = [];
  const cards: CardDraft[] = [];
  const now = o0.simSeconds + dt;
  const o: OnboardingState = { ...o0, simSeconds: now, connectors: { ...o0.connectors }, lanes: o0.lanes.map((l) => ({ ...l, chips: [...l.chips] })), questions: o0.questions.map((q) => ({ ...q })) };

  // Connectors
  for (const s of SOURCES) {
    if (s.kind !== "connector") continue;
    const c = o.connectors[s.id];
    if (c !== "connecting" && c !== "slow") continue;
    const slow = s.id === "analytics" && o.drills.includes("slow-connector");
    const fails = s.id === "helpchat" && o.drills.includes("source-fails");
    if (fails && now >= FAIL_AT) {
      o.connectors[s.id] = "failed";
      events.push({ kind: "connector", name: `${s.id}.failed`, detail: `${s.name} did not respond` });
    } else if (slow && now >= CONNECT_SECONDS && c === "connecting") {
      o.connectors[s.id] = "slow";
      events.push({ kind: "connector", name: `${s.id}.slow`, detail: `${s.name} is slower than usual` });
    } else if (now >= (slow ? SLOW_SECONDS : CONNECT_SECONDS)) {
      const partial = s.id === "analytics" && o.drills.includes("partial-data");
      o.connectors[s.id] = partial ? "partial" : "connected";
      events.push({ kind: "connector", name: `${s.id}.${partial ? "partial" : "connected"}`, detail: partial ? `${s.name} returned 62% of the expected events` : `${s.name} connected` });
    }
  }

  const asked = o.questions.filter((q) => q.status !== "waiting").length;
  let budget = Math.max(0, maxQuestions - asked);

  for (const l of o.lanes) {
    const def = laneDef(l.id);
    if (l.status === "done" || l.status === "skipped") continue;
    const missing = def.needs.filter((s) => sourceDead(o, s));
    if (missing.length) {
      if (l.status !== "failed" || !missing.some((s) => o.connectors[s] === "failed")) {
        const failed = missing.find((s) => o.connectors[s] === "failed");
        const next: LaneStatus = failed ? "failed" : "skipped";
        if (l.status !== next) {
          l.status = next;
          l.note = failed ? `${sourceDef(failed).name} failed to connect.` : sourceDef(missing[0]).withoutIt;
          l.doneAt = failed ? null : now;
          events.push({ kind: "lane", name: `${l.id}.${next}`, detail: l.note });
        }
      }
      continue;
    }
    const waitingOn = def.needs.filter((s) => !sourceReady(o, s));
    if (waitingOn.length) {
      if (l.status !== "connecting" && now >= def.startAt) {
        l.status = "connecting";
        events.push({ kind: "lane", name: `${l.id}.connecting`, detail: `Waiting for ${sourceDef(waitingOn[0]).name}` });
      }
      if (o.connectors[waitingOn[0]] === "slow") l.note = `${sourceDef(waitingOn[0]).name} is slow. You can continue with Chargebee data only.`;
      continue;
    }
    if (now < def.startAt) continue;
    if (l.startedAt == null) {
      l.startedAt = now;
      l.status = "reading";
      l.note = null;
      events.push({ kind: "lane", name: `${l.id}.reading`, detail: def.title });
    }
    if (l.status === "needs-you") {
      const q = o.questions.find((x) => x.lane === l.id && x.status === "asked");
      if (q) continue;
    }
    const total = def.read + def.understand;
    const elapsed = now - (l.startedAt ?? now);
    l.progress = Math.min(1, elapsed / total);
    l.count = Math.round(laneTotal(t, l.id) * Math.min(1, elapsed / def.read));
    if (l.status === "reading" && elapsed >= def.read) {
      l.status = "understanding";
      events.push({ kind: "lane", name: `${l.id}.understanding`, detail: def.title });
    }
    // Chips arrive through reading and understanding.
    const all = laneCards(t, l.id, env, o);
    const due = Math.min(all.length, Math.floor(l.progress * (all.length + 1)));
    for (let i = l.chips.length; i < due; i++) {
      l.chips.push(all[i].id);
      cards.push(all[i]);
      events.push({ kind: "card", name: `${all[i].id}.learned`, detail: all[i].title });
    }
    if (l.progress >= 1) {
      const qdef = QUESTIONS.find((x) => x.lane === l.id);
      const q = qdef ? o.questions.find((x) => x.id === qdef.id) : null;
      if (qdef && q && q.status === "waiting" && budget > 0 && qdef.ask(t, o)) {
        q.status = "asked";
        q.at = String(now);
        budget -= 1;
        l.status = "needs-you";
        events.push({ kind: "question", name: `${q.id}.asked`, detail: qdef.ask(t, o) ?? "" });
        continue;
      }
      // Make sure every card is out before the lane closes.
      for (let i = l.chips.length; i < all.length; i++) {
        l.chips.push(all[i].id);
        cards.push(all[i]);
      }
      const enrich = def.enrichedBy.filter((s) => !sourceReady(o, s) || o.connectors[s] === "partial");
      l.partial = enrich.length > 0;
      l.note = enrich.length ? (o.connectors[enrich[0]] === "partial" ? `${sourceDef(enrich[0]).name} returned 62% of events; patterns marked medium confidence.` : sourceDef(enrich[0]).withoutIt) : null;
      l.status = "done";
      l.doneAt = now;
      events.push({ kind: "lane", name: `${l.id}.done`, detail: l.partial ? "partial" : "complete" });
    }
  }

  if (o.lanes.every((l) => l.status === "done" || l.status === "skipped")) {
    o.stage = "reveal";
    events.push({ kind: "lane", name: "all.done", detail: `All lanes finished at ${clock(now)}` });
  }
  return { o, cards, events };
}

export function answerQuestion(o: OnboardingState, id: string, answer: string | null, at: string): OnboardingState {
  return {
    ...o,
    questions: o.questions.map((q) => (q.id === id ? { ...q, status: answer == null ? "skipped" : "answered", answer, at } : q)),
    lanes: o.lanes.map((l) => (l.status === "needs-you" && o.questions.find((q) => q.id === id)?.lane === l.id ? { ...l, status: "understanding" } : l)),
  };
}

/** Fallback for a failed or slow connector: carry on with Chargebee data only. */
export function chargebeeOnly(o: OnboardingState, source: SourceId): OnboardingState {
  return { ...o, connectors: { ...o.connectors, [source]: "fallback" as ConnectorState } };
}

export function retryConnector(o: OnboardingState, source: SourceId): OnboardingState {
  return { ...o, drills: o.drills.filter((d) => !(d === "source-fails" && source === "helpchat") && !(d === "slow-connector" && source === "analytics")), connectors: { ...o.connectors, [source]: "connecting" as ConnectorState }, lanes: o.lanes.map((l) => (laneDef(l.id).needs.includes(source) ? { ...l, status: "queued" as LaneStatus, note: null, startedAt: null, progress: 0, count: 0 } : l)) };
}

/** Consent withdrawn: the source is forgotten, lanes that need it stop, cards it produced are forgotten. */
export function withdrawSource(o: OnboardingState, source: SourceId): OnboardingState {
  return {
    ...o,
    sources: { ...o.sources, [source]: false },
    connectors: { ...o.connectors, [source]: "forgotten" as ConnectorState },
    lanes: o.lanes.map((l) => (laneDef(l.id).needs.includes(source) && l.status !== "done" ? { ...l, status: "skipped" as LaneStatus, note: `Consent withdrawn. ${sourceDef(source).withoutIt}` } : l)),
  };
}

export function clock(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** Card ids produced by a source, so withdrawing consent can forget them. */
export function cardsFromSource(cards: MemoryCard[], source: SourceId): string[] {
  const label = { billing: "subscriptions", usage: "usage events", policy: "policy library", providers: "Provider cost", analytics: "Product analytics", helpchat: "Help chat" }[source];
  return cards.filter((c) => c.source.includes(label)).map((c) => c.id);
}

// ------------------------------------------------------------------ the reveal

export interface Finding {
  id: string;
  title: string;
  evidence: string[];
  impact: [number, number];
  impactLabel: string;
  explore: { tab: string; label: string; segment?: string; prompt?: string };
  needs: string[];
}

export function findings(t: Ctx, memory: MemoryCard[]): { shown: Finding[]; hidden: { title: string; because: string[] }[] } {
  const pack = t.pack;
  const sim = growthSim(t);
  const k = scaleOf(pack);
  const live = new Map(memory.filter((c) => !c.forgotten).map((c) => [c.id, c]));
  const price = pack.plans.find((p) => p.paid && !p.proposed && p.price != null)?.price ?? 0;
  const quiet = segmentById(t, "free-quiet");
  const topUp = [...sim.cohorts.source, ...sim.cohorts.region].filter((r) => r.workspaces >= 50).sort((a, b) => b.topUpPct - a.topUpPct)[0];
  const avgTop = sim.totals.topUpBuyers / Math.max(1, sim.workspaces.length);
  const def = sim.models.filter((m) => m.isDefault).sort((a, b) => b.providerCost - a.providerCost)[0];
  const cheap = def ? sim.models.filter((m) => !m.isDefault && m.enrichment === def.enrichment).sort((a, b) => a.providerCost / Math.max(1, a.runs) - b.providerCost / Math.max(1, b.runs))[0] : undefined;
  const perRun = (m?: { providerCost: number; runs: number }) => (m ? m.providerCost / Math.max(1, m.runs) : 0);
  const saving = def && cheap ? (((perRun(def) - perRun(cheap)) * def.runs) / 3) * k : 0;
  const disc = sim.chats.filter((c) => c.intent === "discount" || c.intent === "free-credits");
  const churn3 = segmentById(t, "paid-month3");
  const all: Finding[] = [
    {
      id: "f-quiet",
      title: "Free users go quiet before they run an enrichment",
      evidence: [live.get("behaviour-never")?.value ?? "", quiet ? `${fmtNum(quiet.size)} free workspaces are quiet before a first enrichment.` : "", live.get("behaviour-quiet")?.value ?? ""].filter(Boolean),
      impact: [Math.round((quiet?.size ?? 0) * 0.02 * price), Math.round((quiet?.size ?? 0) * 0.05 * price)],
      impactLabel: "MRR a month if 2–5% of them convert",
      explore: { tab: "overview", label: "Explore the cohort", segment: "free-quiet" },
      needs: ["behaviour-never", "behaviour-quiet"],
    },
    {
      id: "f-topup",
      title: topUp ? `${topUp.label} workspaces top up ${(topUp.topUpPct / Math.max(0.001, avgTop)).toFixed(1)}× more than average` : "A cohort with strong top-up behaviour",
      evidence: [topUp ? `${fmtPct(topUp.topUpPct)} of ${topUp.label} workspaces bought a top-up in 90 days, against ${fmtPct(avgTop)} overall.` : "", live.get("behaviour-topups")?.value ?? ""].filter(Boolean),
      impact: [Math.round((sim.totals.topUpRevenue / 3) * k * 0.1), Math.round((sim.totals.topUpRevenue / 3) * k * 0.3)],
      impactLabel: "more top-up revenue a month if lookalikes behave like them",
      explore: { tab: "overview", label: "See thriving cohorts", segment: "paid-topup" },
      needs: ["behaviour-topups", "customers-sources"],
    },
    {
      id: "f-model",
      title: "Most AI research runs stay on the costliest default model",
      evidence: [live.get("models-default")?.value ?? "", live.get("models-cheaper")?.value ?? ""].filter(Boolean),
      impact: [Math.round(saving * 0.3), Math.round(saving * 0.6)],
      impactLabel: "provider cost saved a month if 30–60% of those runs move",
      explore: { tab: "ask", label: "Ask which model should replace it", prompt: "Which model should replace the costliest default?" },
      needs: ["models-default"],
    },
    {
      id: "f-discount",
      title: "A cluster of discount and free-credit requests in help chat",
      evidence: [live.get("helpchat-clusters")?.value ?? "", live.get("helpchat-discount")?.value ?? ""].filter(Boolean),
      impact: [Math.round(disc.length * k * 0.3 * price), Math.round(disc.length * k * 0.6 * price)],
      impactLabel: "MRR protected a month with matched offers instead of blanket discounts",
      explore: { tab: "plays", label: "See matched-offer plays" },
      needs: ["helpchat-clusters"],
    },
    {
      id: "f-churn3",
      title: "Paid workspaces leave around month three",
      evidence: [live.get("behaviour-churn3")?.value ?? "", churn3 ? `${fmtNum(churn3.size)} paid workspaces are two to four months in and have never topped up. ${churn3.drivers[2]}.` : ""].filter(Boolean),
      impact: [Math.round((churn3?.stake ?? 0) * 0.1), Math.round((churn3?.stake ?? 0) * 0.25)],
      impactLabel: "MRR kept a month if 10–25% are saved",
      explore: { tab: "churn", label: "Open churn arrest" },
      needs: ["behaviour-churn3"],
    },
  ];
  const shown: Finding[] = [];
  const hidden: { title: string; because: string[] }[] = [];
  for (const f of all) {
    const gone = f.needs.filter((id) => !live.has(id));
    if (gone.length || f.evidence.length === 0) hidden.push({ title: f.title, because: gone.map((id) => memory.find((c) => c.id === id)?.title ?? id) });
    else shown.push(f);
  }
  return { shown, hidden };
}

export function laneStatusLabel(s: LaneRun["status"]): string {
  return { queued: "Queued", connecting: "Connecting", reading: "Reading", understanding: "Understanding", "needs-you": "Needs you", done: "Done", skipped: "Skipped", failed: "Failed" }[s];
}

export function amountLabel(t: Ctx, v: number): string {
  return amountText(primaryMeter(t.pack), v);
}

export type { CardDraft };
export type { QuestionState };
