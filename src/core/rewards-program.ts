// Rewards that attach to good behaviour, never to logins: Daily Spark, the one-time activation
// reward and badges. Every grant goes through the anti-abuse rules (one wallet per verified
// domain, velocity limits) and lands in the ledger as source "reward" with a reason code.
import type { TenantPack } from "@/tenants/schema";
import type { HubAccountState, LedgerEntry, TenantState } from "@/core/types";
import type { Ctx } from "@/core/metering";
import { addDays, cycleOf, DAY_MS, r1 } from "@/core/time";
import { primaryMeter } from "@/core/pack";
import { lotsOf } from "@/core/ledger";

export const dayKey = (ts: string | Date) => new Date(ts).toISOString().slice(0, 10);

export function sparkMeter(pack: TenantPack): string {
  return pack.hub.spark.meter ?? primaryMeter(pack).id;
}

export function sparkEnabled(pack: TenantPack): boolean {
  return pack.hub.spark.monthlyCap > 0 && pack.hub.spark.amount > 0;
}

function rewardGrants(ledger: LedgerEntry[], account: string): LedgerEntry[] {
  return ledger.filter((e) => e.account === account && e.kind === "grant" && e.source === "reward");
}

/** Null when the grant may go ahead, else the rule that refuses it. */
export function abuseCheck(pack: TenantPack, hub: HubAccountState, ledger: LedgerEntry[], account: string, ts: string): string | null {
  const rules = pack.hub.antiAbuse;
  if (rules.walletPerDomain && !hub.rewardState.domainVerified) return "Rewards need a verified work domain (one wallet per domain)";
  const now = new Date(ts).getTime();
  const grants = rewardGrants(ledger, account);
  const today = grants.filter((e) => now - new Date(e.ts).getTime() < DAY_MS && new Date(e.ts).getTime() <= now).length;
  if (today >= rules.maxGrantsPerDay) return `Velocity limit: ${rules.maxGrantsPerDay} reward grants a day`;
  const week = grants.filter((e) => now - new Date(e.ts).getTime() < 7 * DAY_MS && new Date(e.ts).getTime() <= now).length;
  if (week >= rules.maxGrantsPerWeek) return `Velocity limit: ${rules.maxGrantsPerWeek} reward grants a week`;
  return null;
}

function refuse(ctx: Ctx, ts: string, what: string, rule: string) {
  const rs = ctx.hub.rewardState;
  if (rs.refused.some((r) => r.what === what && dayKey(r.at) === dayKey(ts))) return;
  rs.refused.push({ at: ts, what, rule });
  ctx.book.event({ ts, account: ctx.persona.id, type: "reward.refused", status: "info", note: `${what} · ${rule}` });
}

function sparkThisCycle(ctx: Ctx): number {
  const t0 = ctx.cycleStart.getTime();
  return ctx.hub.rewardState.sparkGranted.filter((g) => new Date(g.day).getTime() >= t0 - DAY_MS).reduce((s, g) => s + g.amount, 0);
}

/** After usage: a run of at least `minRows` rows that returned verified results qualifies the day for a Spark, and a first one activates the account. */
export function afterQualifyingUsage(ctx: Ctx, ts: string, rows: number, verified: number) {
  const cfg = ctx.pack.hub;
  if (rows < Math.min(cfg.spark.minRows, cfg.activation.minRows) || verified <= 0) return;
  const rs = ctx.hub.rewardState;
  const day = dayKey(ts);
  const meter = sparkMeter(ctx.pack);
  if (!rs.activatedAt && rows >= cfg.activation.minRows && verified >= cfg.activation.minRows) {
    const rule = abuseCheck(ctx.pack, ctx.hub, ctx.book.ledger, ctx.persona.id, ts);
    rs.activatedAt = ts;
    if (rule) refuse(ctx, ts, "Activation reward", rule);
    else if (cfg.activation.amount > 0) {
      const ev = ctx.book.event({ ts, account: ctx.persona.id, type: "reward.activation", status: "ok", meters: { [meter]: cfg.activation.amount }, note: `First enrichment with ${verified} verified rows` });
      ctx.book.post({ ts, account: ctx.persona.id, meter, kind: "grant", source: "reward", amount: cfg.activation.amount, reason: "reward.activation", actor: "system:rewards", eventId: ev.id, note: "Activation reward · one per domain", expiresAt: addDays(new Date(ts), 30).toISOString(), idempotencyKey: `activation:${ctx.hub.profile.email.split("@")[1] ?? ctx.persona.id}` });
    }
  }
  if (rows < cfg.spark.minRows || !sparkEnabled(ctx.pack)) return;
  if (!rs.sparkDays.includes(day)) rs.sparkDays.push(day);
  if (rs.sparkGranted.some((g) => g.day === day)) return;
  const left = cfg.spark.monthlyCap - sparkThisCycle(ctx);
  if (left <= 0) return;
  const rule = abuseCheck(ctx.pack, ctx.hub, ctx.book.ledger, ctx.persona.id, ts);
  if (rule) return refuse(ctx, ts, cfg.spark.label, rule);
  const amount = Math.min(cfg.spark.amount, left);
  const ev = ctx.book.event({ ts, account: ctx.persona.id, type: "reward.spark", status: "ok", meters: { [meter]: amount }, note: `${cfg.spark.label} · ${rows} rows with ${verified} verified` });
  const e = ctx.book.post({ ts, account: ctx.persona.id, meter, kind: "grant", source: "reward", amount, reason: "reward.spark", actor: "system:rewards", eventId: ev.id, note: cfg.spark.label, expiresAt: addDays(new Date(ts), cfg.spark.expiryDays).toISOString(), idempotencyKey: `spark:${ctx.persona.id}:${day}` });
  rs.sparkGranted.push({ day, entryId: e.id, amount });
}

export function awardBadge(ctx: Ctx, ts: string, badgeId: string): "awarded" | "already" | "unknown" | "refused" {
  const b = ctx.pack.hub.badges.find((x) => x.id === badgeId);
  if (!b) return "unknown";
  const rs = ctx.hub.rewardState;
  if (rs.badges.some((x) => x.id === badgeId)) return "already";
  let entryId: string | null = null;
  if (b.amount > 0) {
    const rule = abuseCheck(ctx.pack, ctx.hub, ctx.book.ledger, ctx.persona.id, ts);
    if (rule) {
      refuse(ctx, ts, b.label, rule);
      return "refused";
    }
    const meter = sparkMeter(ctx.pack);
    const ev = ctx.book.event({ ts, account: ctx.persona.id, type: "reward.badge", status: "ok", meters: { [meter]: b.amount }, note: b.label });
    entryId = ctx.book.post({ ts, account: ctx.persona.id, meter, kind: "grant", source: "reward", amount: b.amount, reason: "reward.badge", actor: "system:rewards", eventId: ev.id, note: `Badge · ${b.label}`, expiresAt: addDays(new Date(ts), 30).toISOString(), idempotencyKey: `badge:${ctx.persona.id}:${b.id}` }).id;
  } else {
    ctx.book.event({ ts, account: ctx.persona.id, type: "reward.badge", status: "ok", note: b.label });
  }
  rs.badges.push({ id: b.id, at: ts, entryId });
  return "awarded";
}

export interface SparkStatus {
  enabled: boolean;
  label: string;
  amount: number;
  meter: string;
  minRows: number;
  expiryDays: number;
  monthlyCap: number;
  earnedThisCycle: number;
  capLeft: number;
  /** Consecutive qualifying days ending today or yesterday. */
  streak: number;
  /** Qualifying days in the last 7. */
  activeDays7: number;
  qualifiedToday: boolean;
  grantedToday: boolean;
  /** Spark credits still unspent and when the first of them expires. */
  unspent: number;
  nextExpiry: string | null;
  refusedRule: string | null;
  last14: { day: string; qualified: boolean; granted: boolean }[];
}

export function sparkStatus(t: TenantState, account: string): SparkStatus {
  const pack = t.pack;
  const cfg = pack.hub.spark;
  const hub = t.hub[account];
  const rs = hub.rewardState;
  const { start } = cycleOf(t);
  const today = dayKey(t.clock);
  const set = new Set(rs.sparkDays);
  let streak = 0;
  let d = new Date(t.clock);
  if (!set.has(dayKey(d))) d = addDays(d, -1);
  while (set.has(dayKey(d))) {
    streak++;
    d = addDays(d, -1);
  }
  const last14 = Array.from({ length: 14 }, (_, i) => {
    const day = dayKey(addDays(new Date(t.clock), i - 13));
    return { day, qualified: set.has(day), granted: rs.sparkGranted.some((g) => g.day === day) };
  });
  const earned = rs.sparkGranted.filter((g) => new Date(g.day).getTime() >= start.getTime() - DAY_MS).reduce((s, g) => s + g.amount, 0);
  const ids = new Set(rs.sparkGranted.map((g) => g.entryId));
  let unspent = 0;
  let nextExpiry: string | null = null;
  for (const lot of lotsOf(t.ledger, account, sparkMeter(pack))) {
    if (!ids.has(lot.id) || lot.remaining <= 0) continue;
    unspent += lot.remaining;
    if (lot.expiresAt && (!nextExpiry || lot.expiresAt < nextExpiry)) nextExpiry = lot.expiresAt;
  }
  const lastRefusal = [...rs.refused].reverse().find((r) => r.what === cfg.label);
  return {
    enabled: sparkEnabled(pack),
    label: cfg.label,
    amount: cfg.amount,
    meter: sparkMeter(pack),
    minRows: cfg.minRows,
    expiryDays: cfg.expiryDays,
    monthlyCap: cfg.monthlyCap,
    earnedThisCycle: r1(earned),
    capLeft: r1(Math.max(0, cfg.monthlyCap - earned)),
    streak,
    activeDays7: last14.slice(7).filter((x) => x.qualified).length,
    qualifiedToday: set.has(today),
    grantedToday: rs.sparkGranted.some((g) => g.day === today),
    unspent: r1(unspent),
    nextExpiry,
    refusedRule: lastRefusal && dayKey(lastRefusal.at) === today ? lastRefusal.rule : null,
    last14,
  };
}
