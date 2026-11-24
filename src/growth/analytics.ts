// Growth Workbench read models over the population simulator (Phase 5): the Today snapshot,
// the breakage pool forecast and funding rule, involuntary churn arrest, behavioural personas
// with plan-variant replay, and the rewards abuse monitor. Counts and money are scaled from the
// simulated sample to the tenant's base (pack.growth.sampleScale).
import type { TenantState } from "@/core/types";
import type { TenantPack } from "@/tenants/schema";
import type { WorkspaceSummary } from "@/sim/usage90-types";
import type { GrowthState } from "@/growth/types";
import { ageDays, entryPrice, growthSim, isPaid, lastDay, scaleOf, segmentMembers } from "@/growth/population";
import { fnv1a } from "@/core/time";
import { grantRule, monthlyAllowance, planOf, primaryMeter } from "@/core/pack";

type Ctx = Pick<TenantState, "pack" | "population" | "clock"> & { growth?: { anchor: string } };
const h = (s: string) => parseInt(fnv1a(s).slice(0, 6), 16) / 0xffffff;
const priceOf = (pack: TenantPack, w: WorkspaceSummary) => planOf(pack, w.planId).price ?? 0;

// ------------------------------------------------------------------ Today (§5.1)

export interface TodaySnapshot {
  asOf: string;
  scale: number;
  mrr: { total: number; new: number; expansion: number; contraction: number; churn: number; net: number };
  credits: { burnPerDay: number; burnPrev: number; attach: number; breakageShare: number; byModel: { model: string; name: string; credits: number; marginPerCredit: number; costPerCredit: number }[] };
  funnel: { label: string; n: number }[];
  churn: { voluntary: number; involuntary: number; voluntaryMrr: number; involuntaryMrr: number };
  burnSeries: { x: string; y: number }[];
  f2pWeekly: { x: string; y: number; signups: number }[];
}

export function involuntary(w: WorkspaceSummary): boolean {
  return h(`invol:${w.id}`) < 0.27;
}

export function todaySnapshot(t: Ctx): TodaySnapshot {
  const pack = t.pack;
  const sim = growthSim(t);
  const k = scaleOf(pack);
  const D = lastDay(sim);
  const ws = sim.workspaces;
  const prepaid = pack.billingModel === "prepaid";
  // Prepaid tenants have no plan price: their recurring revenue is usage, so read it from the simulated revenue.
  const mrrOf = (w: WorkspaceSummary) => (prepaid ? w.revenue / 3 : priceOf(pack, w));
  const paidLive = ws.filter((w) => isPaid(pack, w) && w.status !== "churned");
  const total = paidLive.reduce((s, w) => s + mrrOf(w), 0);
  const fresh = paidLive.filter((w) => w.signupDay > D - 30).reduce((s, w) => s + mrrOf(w), 0);
  const expansion = prepaid ? 0 : sim.daily.slice(-30).reduce((s, d) => s + d.topUpRevenue, 0);
  const lower = (w: WorkspaceSummary) => {
    const p = priceOf(pack, w);
    const below = pack.plans.filter((x) => x.paid && x.price != null && x.price < p && !x.proposed).map((x) => x.price!);
    return below.length ? p - Math.max(...below) : 0;
  };
  const contraction = paidLive.filter((w) => (w.status === "idle" || (w.lastActiveDay ?? 0) <= D - 7) && h(`down:${w.id}`) < 0.3).reduce((s, w) => s + (prepaid ? mrrOf(w) * 0.3 : lower(w)), 0);
  const churned = ws.filter((w) => isPaid(pack, w) && w.status === "churned" && (w.lastActiveDay ?? 0) > D - 30);
  const churnMrr = churned.reduce((s, w) => s + mrrOf(w), 0);
  const prim = primaryMeter(pack);
  const last7 = sim.daily.slice(-7).reduce((s, d) => s + d.credits, 0) / 7;
  const prev7 = sim.daily.slice(-14, -7).reduce((s, d) => s + d.credits, 0) / 7;
  const models = new Map<string, { credits: number; cost: number }>();
  for (const m of sim.models) {
    const x = models.get(m.model) ?? { credits: 0, cost: 0 };
    x.credits += m.credits;
    x.cost += m.providerCost;
    models.set(m.model, x);
  }
  const byModel = [...models.entries()]
    .map(([model, x]) => ({ model, name: pack.models.find((m) => m.id === model)?.name ?? model, credits: x.credits * k, costPerCredit: x.credits ? x.cost / x.credits : 0, marginPerCredit: prim.pricePerUnit - (x.credits ? x.cost / x.credits : 0) }))
    .sort((a, b) => a.marginPerCredit - b.marginPerCredit);
  const signups = ws.filter((w) => w.signupDay >= 0);
  const activated = signups.filter((w) => w.firstRunDay != null);
  const capped = signups.filter((w) => w.blocked > 0 || isPaid(pack, w));
  const paid = signups.filter((w) => isPaid(pack, w));
  const weeks: TodaySnapshot["f2pWeekly"] = [];
  for (let wk = 11; wk >= 0; wk--) {
    const from = D - 7 * (wk + 1) + 1;
    const to = D - 7 * wk;
    const xs = ws.filter((w) => w.signupDay >= from && w.signupDay <= to);
    const d = new Date(sim.windowStart);
    d.setDate(d.getDate() + from);
    weeks.push({ x: d.toLocaleDateString("en-GB", { day: "numeric", month: "short" }), y: xs.length ? xs.filter((w) => isPaid(pack, w)).length / xs.length : 0, signups: xs.length * k });
  }
  const br = breakageForecast(t, null);
  const invol = churned.filter(involuntary);
  return {
    asOf: sim.anchor,
    scale: k,
    mrr: { total: total * k, new: fresh * k, expansion: expansion * k, contraction: contraction * k, churn: churnMrr * k, net: (fresh + expansion - contraction - churnMrr) * k },
    credits: { burnPerDay: last7 * k, burnPrev: prev7 * k, attach: sim.totals.topUpBuyers / Math.max(1, sim.totals.paid), breakageShare: br.share, byModel },
    funnel: [
      { label: "Signed up (90 days)", n: signups.length * k },
      { label: "Ran a first enrichment", n: activated.length * k },
      { label: "Hit a cap or chose a paid plan", n: capped.length * k },
      { label: "On a paid plan", n: paid.length * k },
    ],
    churn: { voluntary: (churned.length - invol.length) * k, involuntary: invol.length * k, voluntaryMrr: (churnMrr - invol.reduce((s, w) => s + mrrOf(w), 0)) * k, involuntaryMrr: invol.reduce((s, w) => s + mrrOf(w), 0) * k },
    burnSeries: sim.daily.slice(-30).map((d) => ({ x: d.date.slice(5, 10), y: Math.round(d.credits * k) })),
    f2pWeekly: weeks,
  };
}

// ------------------------------------------------------------------ breakage pool (§5.9)

export interface BreakageRow {
  id: string;
  label: string;
  accounts: number;
  credits: number;
  usd: number;
}

export interface BreakageForecast {
  rows: BreakageRow[];
  credits: number;
  usd: number;
  granted: number;
  share: number;
  capX: number | null;
}

/** Credits that will expire unused next month, by cohort: each paid workspace's unused allowance once its rollover carry is full. */
export function breakageForecast(t: Ctx, capOverride: number | null): BreakageForecast {
  const pack = t.pack;
  const sim = growthSim(t);
  const k = scaleOf(pack);
  const prim = primaryMeter(pack);
  const rows = new Map<string, BreakageRow>();
  let credits = 0;
  let usd = 0;
  let granted = 0;
  let capSeen: number | null = null;
  const quiet = new Set(segmentMembers(sim, pack, "quiet-credits").map((w) => w.id));
  for (const w of sim.workspaces) {
    if (!isPaid(pack, w) || w.status === "churned") continue;
    const plan = planOf(pack, w.planId);
    const A = monthlyAllowance(pack, w.planId, prim.id);
    if (!A) continue;
    granted += A;
    const used = w.credits / 3;
    const unused = Math.max(0, A - used);
    const rule = grantRule(pack, w.planId, prim.id);
    const cap = rule.rollover.mode === "capped" ? (capOverride ?? rule.rollover.capX) : rule.rollover.mode === "full" ? Infinity : 0;
    if (rule.rollover.mode === "capped") capSeen = capOverride ?? rule.rollover.capX;
    const months = Math.max(1, Math.floor(ageDays(sim, w) / 30));
    const saturated = cap === 0 || (Number.isFinite(cap) && unused * months >= cap * A);
    const exp = saturated ? unused : 0;
    if (exp <= 0) continue;
    const value = exp * ((plan.price ?? 0) / A);
    credits += exp;
    usd += value;
    const key = quiet.has(w.id) ? "quiet" : w.planId;
    const r = rows.get(key) ?? { id: key, label: key === "quiet" ? "Quiet paid workspaces" : `${plan.name} plan`, accounts: 0, credits: 0, usd: 0 };
    r.accounts += 1;
    r.credits += exp;
    r.usd += value;
    rows.set(key, r);
  }
  const out = [...rows.values()].map((r) => ({ ...r, accounts: r.accounts * k, credits: Math.round(r.credits * k), usd: Math.round(r.usd * k) })).sort((a, b) => b.usd - a.usd);
  return { rows: out, credits: Math.round(credits * k), usd: Math.round(usd * k), granted: Math.round(granted * k), share: granted ? credits / granted : 0, capX: capSeen };
}

export interface PoolStatus {
  forecastUsd: number;
  recognisedUsd: number;
  fundingCap: number;
  committed: number;
  available: number;
}

export function poolStatus(t: Ctx, g: GrowthState["breakage"]): PoolStatus {
  const f = breakageForecast(t, null);
  const recognised = (f.usd * g.recognisedPct) / 100;
  const cap = (f.usd * g.fundingPct) / 100;
  const committed = g.commits.reduce((s, c) => s + c.usd, 0);
  return { forecastUsd: f.usd, recognisedUsd: Math.round(recognised), fundingCap: Math.round(cap), committed: Math.round(committed), available: Math.max(0, Math.round(cap - committed)) };
}

export function upsellCandidates(t: Ctx): { total: number; highIntent: number } {
  const sim = growthSim(t);
  const xs = segmentMembers(sim, t.pack, "free-blocked");
  const high = xs.filter((w) => w.blocked >= 3 && w.runs >= 2);
  const k = scaleOf(t.pack);
  return { total: xs.length * k, highIntent: high.length * k };
}

// ------------------------------------------------------------------ involuntary churn arrest (§5.7)

export type RetryStrategy = "standard" | "smart" | "short";
export const STRATEGIES: { id: RetryStrategy; label: string; days: string; soft: number; hard: number }[] = [
  { id: "standard", label: "Fixed schedule", days: "Day 0, 1, 3, 5, 7", soft: 0.48, hard: 0.12 },
  { id: "smart", label: "Smart retries (payday-aware)", days: "Day 0, then the next likely payday, then 3 days later", soft: 0.61, hard: 0.14 },
  { id: "short", label: "Short schedule", days: "Day 0, 3, 7", soft: 0.41, hard: 0.1 },
];

export interface ArrestRow {
  id: string;
  name: string;
  plan: string;
  mrr: number;
  decline: "soft" | "hard";
  reason: string;
  attempts: number;
  graceLeft: number;
  action: string;
}

export interface Arrest {
  failed: number;
  soft: number;
  hard: number;
  recovered: number;
  lost: number;
  pending: number;
  atRiskMrr: number;
  recoveryRate: number;
  byStrategy: { id: RetryStrategy; label: string; days: string; rate: number }[];
  pre: { expiring: number; nudged: number; updated: number };
  queue: ArrestRow[];
}

export function leverBoost(l: GrowthState["levers"]): { soft: number; hard: number } {
  const msg = l.message === "helpful" ? 0.05 : l.message === "loss" ? 0.03 : 0;
  const grace = l.graceCredits ? 0.06 : 0;
  const days = Math.min(0.05, Math.max(0, l.graceDays - 7) * 0.006);
  return { soft: msg + grace + days, hard: (l.backupPrompt ? 0.08 : 0) + msg / 2 + grace / 2 };
}

export function arrest(t: Ctx, levers: GrowthState["levers"], rescued: string[] = []): Arrest {
  const pack = t.pack;
  const sim = growthSim(t);
  const k = scaleOf(pack);
  const paid = sim.workspaces.filter((w) => isPaid(pack, w) && w.status !== "churned");
  const failing = paid.filter((w) => h(`fail:${w.id}`) < 0.045);
  const hard = failing.filter((w) => h(`hard:${w.id}`) < 0.3);
  const soft = failing.length - hard.length;
  const boost = leverBoost(levers);
  const strat = STRATEGIES.find((s) => s.id === levers.retry) ?? STRATEGIES[0];
  const rate = (s: (typeof STRATEGIES)[number]) => ((s.soft + boost.soft) * soft + (s.hard + boost.hard) * hard.length) / Math.max(1, failing.length);
  const recovered = Math.round(failing.length * rate(strat) * 0.6);
  const lost = Math.round(failing.length * (1 - rate(strat)) * 0.35);
  const reasons = { soft: ["Insufficient funds", "Bank declined, try again", "Card limit reached"], hard: ["Card expired", "Card reported lost", "Account closed"] };
  const queue: ArrestRow[] = failing
    .filter((w) => !rescued.includes(w.id))
    .map((w) => {
      const isHard = hard.includes(w);
      const attempts = 1 + Math.floor(h(`att:${w.id}`) * 4);
      const mrr = priceOf(pack, w);
      const action = isHard ? (levers.backupPrompt ? "Ask for a backup method, then a new card" : "Send a one-tap card update link") : attempts >= 3 ? "Offer a backup payment method" : mrr >= 400 ? "Personal note from the account owner" : levers.retry === "smart" ? "Retry on the next likely payday" : "Retry on schedule";
      const r = reasons[isHard ? "hard" : "soft"];
      return { id: w.id, name: w.name, plan: planOf(pack, w.planId).name, mrr, decline: isHard ? ("hard" as const) : ("soft" as const), reason: r[Math.floor(h(`r:${w.id}`) * r.length)], attempts, graceLeft: Math.max(0, levers.graceDays - attempts - 1), action };
    })
    .sort((a, b) => b.mrr - a.mrr);
  const expiring = segmentMembers(sim, pack, "card-expiring").length;
  return {
    failed: failing.length * k,
    soft: soft * k,
    hard: hard.length * k,
    recovered: recovered * k,
    lost: lost * k,
    pending: Math.max(0, failing.length - recovered - lost) * k,
    atRiskMrr: failing.reduce((s, w) => s + priceOf(pack, w), 0) * k,
    recoveryRate: rate(strat),
    byStrategy: STRATEGIES.map((s) => ({ id: s.id, label: s.label, days: s.days, rate: rate(s) })),
    pre: { expiring: expiring * k, nudged: Math.round(expiring * 0.92) * k, updated: Math.round(expiring * (0.41 + (levers.message === "helpful" ? 0.06 : 0))) * k },
    queue,
  };
}

// ------------------------------------------------------------------ personas and plan variants (§5.8)

export type PersonaKey = "explorer" | "operator" | "scaler" | "agency";
export const PERSONA_INFO: Record<PersonaKey, { label: string; desc: string }> = {
  explorer: { label: "Explorer", desc: "Tries a few enrichments, light and irregular usage" },
  operator: { label: "Operator", desc: "Steady weekly tables, mostly on defaults" },
  scaler: { label: "Scaler", desc: "Usage grows past the allowance; buys top-ups" },
  agency: { label: "Agency", desc: "Many tables and seats, runs work for several clients" },
};

export function personaOf(pack: TenantPack, w: WorkspaceSummary): PersonaKey {
  const prim = primaryMeter(pack);
  const A = monthlyAllowance(pack, w.planId, prim.id) || 1;
  if (w.seats >= 4 || w.tables >= 8) return "agency";
  if (w.topUps > 0 || w.credits / 3 > 1.1 * A) return "scaler";
  if (w.runs >= 12 && w.status === "active") return "operator";
  return "explorer";
}

export interface PersonaRow {
  id: PersonaKey;
  label: string;
  desc: string;
  n: number;
  paid: number;
  medianCredits: number;
  arpu: number;
}

export function personas(t: Ctx): PersonaRow[] {
  const pack = t.pack;
  const sim = growthSim(t);
  const k = scaleOf(pack);
  const groups = new Map<PersonaKey, WorkspaceSummary[]>();
  for (const w of sim.workspaces) {
    if (w.firstRunDay == null) continue;
    const p = personaOf(pack, w);
    groups.set(p, [...(groups.get(p) ?? []), w]);
  }
  return (Object.keys(PERSONA_INFO) as PersonaKey[]).map((id) => {
    const xs = groups.get(id) ?? [];
    const cr = xs.map((w) => w.credits / 3).sort((a, b) => a - b);
    const paid = xs.filter((w) => isPaid(pack, w));
    return { id, ...PERSONA_INFO[id], n: xs.length * k, paid: paid.length * k, medianCredits: Math.round(cr[Math.floor(cr.length / 2)] ?? 0), arpu: paid.length ? paid.reduce((s, w) => s + w.revenue / 3, 0) / paid.length : 0 };
  });
}

export interface Variant {
  id: string;
  label: string;
  desc: string;
  revenue: number;
  margin: number;
  conversion: number;
  churn: number;
  score: number;
  byPersona: Record<PersonaKey, number>;
}

/** Replay 90 days of usage against plan variants. Revenue and margin come from the replay; conversion and churn shifts are model estimates. */
export function planVariants(t: Ctx): Variant[] {
  const pack = t.pack;
  const sim = growthSim(t);
  const k = scaleOf(pack);
  const prim = primaryMeter(pack);
  const costPerCredit = sim.totals.credits ? sim.totals.providerCost / sim.totals.credits : 0;
  const paid = sim.workspaces.filter((w) => isPaid(pack, w) && w.status !== "churned");
  const free = sim.workspaces.filter((w) => !isPaid(pack, w));
  const unit = prim.pricePerUnit;
  type Fn = (w: WorkspaceSummary, monthly: number, A: number, price: number, p: PersonaKey) => number;
  const run = (id: string, label: string, desc: string, fn: Fn, conv: number, churn: number): Variant => {
    let rev = 0;
    let cost = 0;
    const byPersona = { explorer: 0, operator: 0, scaler: 0, agency: 0 } as Record<PersonaKey, number>;
    for (const w of paid) {
      const monthly = w.credits / 3;
      const A = monthlyAllowance(pack, w.planId, prim.id) || 1;
      const p = personaOf(pack, w);
      const r = fn(w, monthly, A, priceOf(pack, w), p);
      rev += r;
      byPersona[p] += r * k;
      cost += monthly * costPerCredit;
    }
    const convRev = free.length * conv * entryPrice(pack) * 0.25;
    const total = (rev + convRev) * k;
    const margin = rev > 0 ? (rev - cost) / rev : 0;
    return { id, label, desc, revenue: total, margin, conversion: conv, churn, score: total * (1 - churn * 3) * (0.5 + margin), byPersona };
  };
  const over = (monthly: number, A: number) => Math.max(0, monthly - A) * unit * 1.1;
  return [
    run("current", "Current plans", "Today's plans, grants and top-ups", (_w, m, A, price) => price + over(m, A), 0.04, 0.053),
    run("packs", "Independent meter packs", "Sell Data Credits and Actions as separate packs on every plan", (_w, m, A, price) => price + Math.max(0, m - A) * unit * 1.0 + price * 0.04, 0.044, 0.05),
    run("grants", "Bigger grants, lower rollover", "25% more included credits, 10% higher prices, rollover capped at 1×", (_w, m, A, price) => price * 1.1 + over(m, A * 1.25), 0.038, 0.049),
    run(
      "persona",
      "Persona plans",
      "Explorer $49, Operator at today's entry price, Scaler with usage, Agency with client workspaces",
      (_w, m, A, price, p) => (p === "explorer" ? 49 + over(m, A * 0.5) : p === "operator" ? price + over(m, A) : p === "scaler" ? price + Math.max(0, m - A) * unit * 0.95 : price * 1.6 + over(m, A * 1.5)),
      0.05,
      0.046,
    ),
  ];
}

export interface Grandfathering {
  id: GrowthState["grandfathering"];
  label: string;
  desc: string;
  existingNow: number;
  existingYear1: number;
  churnShift: number;
}

export function grandfathering(t: Ctx, v: Variant): Grandfathering[] {
  const cur = planVariants(t).find((x) => x.id === "current")!;
  const delta = v.revenue - cur.revenue;
  return [
    { id: "12-months", label: "Keep existing customers on today's plans for 12 months", desc: "New customers get the new plans; existing ones move after a year with 60 days' notice.", existingNow: 0, existingYear1: 0, churnShift: 0 },
    { id: "renewal-credit", label: "Move at renewal with a 3-month credit", desc: "Existing customers move at their next renewal and get the difference back as credits for 3 months.", existingNow: Math.round(delta * 0.25), existingYear1: Math.round(delta * 0.75), churnShift: 0.004 },
    { id: "migrate-now", label: "Move everyone now", desc: "Fastest revenue change and the highest churn risk.", existingNow: Math.round(delta), existingYear1: Math.round(delta * 12), churnShift: 0.012 },
  ];
}

// ------------------------------------------------------------------ rewards abuse monitor (§5.10)

const FREE_DOMAINS = ["gmail.com", "outlook.com", "proton.me", "yahoo.com"];
export const LOW_VALUE_ACTIONS = ["log in", "login", "open the app", "visit", "view a page", "click", "sign up only", "invite an unverified", "watch a video"];

export function isLowValue(action: string): boolean {
  const a = action.toLowerCase();
  return LOW_VALUE_ACTIONS.some((x) => a.includes(x));
}

export interface AbuseRow {
  domain: string;
  wallets: number;
  days: number;
  grantsClaimed: number;
  flag: "many wallets" | "velocity spike" | "watch";
}

export function abuseMonitor(t: Ctx): { rows: AbuseRow[]; walletsChecked: number; refused: number } {
  const pack = t.pack;
  const sim = growthSim(t);
  const k = scaleOf(pack);
  const free = sim.workspaces.filter((w) => !isPaid(pack, w));
  const byDomain = new Map<string, WorkspaceSummary[]>();
  for (const w of free) {
    const u = h(`dom:${w.id}`);
    const domain = u < 0.24 ? FREE_DOMAINS[Math.floor(u * 100) % FREE_DOMAINS.length] : u > 0.985 ? ["leadgen-hub.io", "growthhax.co"][Math.floor(u * 1000) % 2] : `${w.name.toLowerCase().replace(/[^a-z]+/g, "")}.com`;
    byDomain.set(domain, [...(byDomain.get(domain) ?? []), w]);
  }
  const rows: AbuseRow[] = [];
  const suspicious = ["leadgen-hub.io", "growthhax.co"];
  for (const [domain, xs] of byDomain) {
    const freeMail = FREE_DOMAINS.includes(domain);
    const sus = suspicious.includes(domain);
    if (!freeMail && !sus) continue;
    const days = new Set(xs.map((w) => w.signupDay)).size;
    // Suspicious domains: many wallets, created in bursts. Free e-mail providers are watched, not flagged: one wallet per verified phone applies.
    const span = sus ? Math.max(1, Math.min(days, 2 + (domain.length % 3))) : days;
    rows.push({ domain, wallets: sus ? xs.length : xs.length * k, days: span, grantsClaimed: (sus ? 1 : k) * xs.filter((w) => w.runs > 0).length, flag: sus ? (span <= 3 ? "velocity spike" : "many wallets") : "watch" });
  }
  rows.sort((a, b) => (a.flag === "watch" ? 1 : 0) - (b.flag === "watch" ? 1 : 0) || b.wallets - a.wallets);
  return { rows: rows.slice(0, 8), walletsChecked: free.length * k, refused: rows.filter((r) => r.flag !== "watch").reduce((s, r) => s + r.grantsClaimed, 0) };
}
