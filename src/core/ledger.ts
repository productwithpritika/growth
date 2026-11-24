// The immutable credit ledger, as pure functions over an append-only array.
//
// Rules (Phase 1 §1.5):
// - Entries are grant, debit, hold, release, rollover, expiry or reversal. Nothing is edited;
//   a correction is a reversal that offsets the original.
// - Every entry has an id, an idempotency key, a reason code and an actor. Posting a key that
//   already exists returns the first entry.
// - Spend order: reward and promo credits first, then plan grants and rollover nearest expiry,
//   then top-ups.
// - A hold reserves credits for a running job; when it completes the difference between the
//   hold and the actual cost is released (or the excess debited), and the hold is closed.
// - The balance never goes negative unless the tenant's ledger policy allows an overdraft.
import type { GrantSource, LedgerEntry, LedgerKind, ReasonCode, TenantState, UsageEvent } from "@/core/types";
import type { BlockReason } from "@/core/block";
import { cycleOf, fnv1a, r2 } from "@/core/time";

const GENESIS = "00000000";
const EPS = 0.005;

function hashInput(e: Omit<LedgerEntry, "hash">): string {
  return [
    e.seq,
    e.ts,
    e.account,
    e.meter,
    e.kind,
    e.source ?? "",
    e.amount,
    e.balance,
    e.reason,
    e.actor,
    e.idempotencyKey,
    e.eventId ?? "",
    e.note,
    e.expiresAt ?? "",
    e.holdId ?? "",
    e.lotId ?? "",
    e.reverses ?? "",
    e.prev,
  ].join("|");
}

export function verifyChain(ledger: LedgerEntry[]): { ok: boolean; brokenAt: number | null } {
  let prev = GENESIS;
  for (const e of ledger) {
    const { hash, ...rest } = e;
    if (e.prev !== prev || fnv1a(hashInput(rest)) !== hash) return { ok: false, brokenAt: e.seq };
    prev = hash;
  }
  return { ok: true, brokenAt: null };
}

// ---------------------------------------------------------------- policy & errors

export interface LedgerPolicy {
  /** When false (the default) no entry may take a balance below zero. */
  allowNegative: boolean;
  /** How far below zero a balance may go when allowNegative is true. */
  overdraft: number;
}
export const DEFAULT_POLICY: LedgerPolicy = { allowNegative: false, overdraft: 0 };

export type LedgerErrorCode = "insufficient_balance" | "idempotency_conflict" | "unknown_entry" | "already_reversed" | "not_reversible" | "invalid_amount" | "unknown_hold";

export class LedgerError extends Error {
  code: LedgerErrorCode;
  reason: BlockReason | null;
  constructor(code: LedgerErrorCode, message: string, reason: BlockReason | null = null) {
    super(message);
    this.code = code;
    this.reason = reason;
  }
}

/** The lowest a balance may reach under a policy. */
export const floorOf = (p: LedgerPolicy) => (p.allowNegative ? -Math.max(0, p.overdraft) : 0);

// ---------------------------------------------------------------- posting

export interface PostInput {
  ts: string;
  account: string;
  meter: string;
  kind: LedgerKind;
  amount: number;
  reason: ReasonCode;
  actor: string;
  eventId: string | null;
  note: string;
  source?: GrantSource | null;
  idempotencyKey?: string;
  expiresAt?: string | null;
  holdId?: string | null;
  lotId?: string | null;
  reverses?: string | null;
}

const DECREASING: LedgerKind[] = ["debit", "hold", "expiry"];

/** The key used when a caller does not pass one: the same logical posting always derives the same key. */
export function deriveKey(e: PostInput): string {
  return `${e.kind}:${fnv1a([e.ts, e.account, e.meter, e.kind, r2(e.amount), e.eventId ?? "", e.holdId ?? "", e.lotId ?? "", e.reverses ?? "", e.note].join("|"))}`;
}

function checkShape(e: PostInput) {
  const a = r2(e.amount);
  if (!Number.isFinite(e.amount)) throw new LedgerError("invalid_amount", "Amount must be a number");
  if ((e.kind === "grant" && a <= 0) || (DECREASING.includes(e.kind) && a > 0) || (e.kind === "release" && a < 0)) {
    throw new LedgerError("invalid_amount", `A ${e.kind} cannot be ${a > 0 ? "positive" : a < 0 ? "negative" : "zero"}`);
  }
  if ((e.kind === "grant" || (e.kind === "rollover" && a > 0)) && !e.source) throw new LedgerError("invalid_amount", "Grants need a source");
  if (e.kind === "reversal" && !e.reverses) throw new LedgerError("invalid_amount", "A reversal names the entry it offsets");
}

/** Working copy of the ledger and event stream for one mutation. */
export class Book {
  ledger: LedgerEntry[];
  events: UsageEvent[];
  policy: LedgerPolicy;
  private bal = new Map<string, number>();
  private keys = new Map<string, LedgerEntry>();
  constructor(ledger: LedgerEntry[], events: UsageEvent[], policy: LedgerPolicy = DEFAULT_POLICY) {
    this.ledger = [...ledger];
    this.events = [...events];
    this.policy = policy;
    for (const e of ledger) {
      this.bal.set(`${e.account}:${e.meter}`, e.balance);
      this.keys.set(e.idempotencyKey, e);
    }
  }
  balance(account: string, meter: string): number {
    return this.bal.get(`${account}:${meter}`) ?? 0;
  }
  /** What can still be spent: balance down to the policy floor. */
  spendable(account: string, meter: string): number {
    return Math.max(0, r2(this.balance(account, meter) - floorOf(this.policy)));
  }
  event(e: Omit<UsageEvent, "seq" | "id">): UsageEvent {
    const seq = this.events.length + 1;
    const full: UsageEvent = { ...e, seq, id: `evt_${String(seq).padStart(5, "0")}` };
    this.events.push(full);
    return full;
  }
  find(key: string): LedgerEntry | undefined {
    return this.keys.get(key);
  }
  /**
   * Append one entry. Same idempotency key → the existing entry comes back and nothing is added
   * (a different amount under the same key is a conflict). Throws `insufficient_balance` when the
   * entry would take the balance below the policy floor.
   */
  post(e: PostInput): LedgerEntry {
    checkShape(e);
    const key = e.idempotencyKey ?? deriveKey(e);
    const dup = this.keys.get(key);
    if (dup) {
      if (dup.amount !== r2(e.amount) || dup.account !== e.account || dup.meter !== e.meter) {
        throw new LedgerError("idempotency_conflict", `Key ${key} was already used for a different posting`);
      }
      return dup;
    }
    const amount = r2(e.amount);
    const before = this.balance(e.account, e.meter);
    const balance = r2(before + amount);
    if (amount < 0 && balance < floorOf(this.policy) - EPS) {
      throw new LedgerError("insufficient_balance", `Balance ${before} cannot cover ${-amount}`, {
        code: "insufficient_balance",
        meter: e.meter,
        needed: -amount,
        available: Math.max(0, r2(before - floorOf(this.policy))),
      });
    }
    const seq = this.ledger.length + 1;
    const prev = this.ledger.length ? this.ledger[this.ledger.length - 1].hash : GENESIS;
    const base: Omit<LedgerEntry, "hash"> = {
      seq,
      id: `led_${String(seq).padStart(5, "0")}`,
      ts: e.ts,
      account: e.account,
      meter: e.meter,
      kind: e.kind,
      source: e.source ?? null,
      amount,
      balance,
      reason: e.reason,
      actor: e.actor,
      idempotencyKey: key,
      eventId: e.eventId,
      note: e.note,
      expiresAt: e.expiresAt ?? null,
      holdId: e.holdId ?? null,
      lotId: e.lotId ?? null,
      reverses: e.reverses ?? null,
      prev,
    };
    const full: LedgerEntry = { ...base, hash: fnv1a(hashInput(base)) };
    this.ledger.push(full);
    this.bal.set(`${e.account}:${e.meter}`, balance);
    this.keys.set(key, full);
    return full;
  }
}

// ---------------------------------------------------------------- lots & spend order

/** Spend tier by source: lower is spent first. */
export const SPEND_TIER: Record<GrantSource, number> = { reward: 0, promo: 0, plan: 1, rollover: 1, topup: 2 };

export interface Lot {
  id: string; // the grant or rollover entry that created it
  source: GrantSource;
  grantedAt: string;
  expiresAt: string | null;
  amount: number;
  remaining: number;
  seq: number;
}

/** Spend order: reward and promo first, then plan and rollover nearest expiry, then top-ups; ties by age. */
export function compareLots(a: Lot, b: Lot): number {
  const t = SPEND_TIER[a.source] - SPEND_TIER[b.source];
  if (t) return t;
  const ea = a.expiresAt ?? "9999";
  const eb = b.expiresAt ?? "9999";
  if (ea !== eb) return ea < eb ? -1 : 1;
  return a.seq - b.seq;
}

type Alloc = { lot: Lot; amt: number }[];

export interface LotState {
  lots: Lot[];
  /** Which lots each debit (by entry id) and each hold (by hold id) drew from. */
  allocations: Map<string, Alloc>;
  /** Amount nothing could cover (only possible under an overdraft policy). */
  shortfall: number;
}

function take(lots: Lot[], amount: number): { alloc: Alloc; short: number } {
  let need = r2(amount);
  const alloc: Alloc = [];
  for (const l of lots.filter((x) => x.remaining > EPS).sort(compareLots)) {
    if (need <= EPS) break;
    const amt = r2(Math.min(l.remaining, need));
    l.remaining = r2(l.remaining - amt);
    need = r2(need - amt);
    alloc.push({ lot: l, amt });
  }
  return { alloc, short: Math.max(0, need) };
}

/** Give credits back to the lots they came from, least-preferred first (the reverse of spend order). */
function restore(alloc: Alloc, amount: number): number {
  let left = r2(amount);
  for (let i = alloc.length - 1; i >= 0 && left > EPS; i--) {
    const a = alloc[i];
    const back = r2(Math.min(a.amt, left));
    a.lot.remaining = r2(a.lot.remaining + back);
    a.amt = r2(a.amt - back);
    left = r2(left - back);
  }
  return left;
}

/** Replay one account/meter in order and return what is left in each lot. */
export function lotState(ledger: LedgerEntry[], account: string, meter: string): LotState {
  const lots: Lot[] = [];
  const byId = new Map<string, Lot>();
  const allocations = new Map<string, Alloc>();
  let shortfall = 0;
  const kindOf = new Map<string, LedgerEntry>();
  for (const e of ledger) {
    if (e.account !== account || e.meter !== meter) continue;
    kindOf.set(e.id, e);
    if ((e.kind === "grant" || e.kind === "rollover") && e.amount > 0) {
      const lot: Lot = { id: e.id, source: e.source ?? "plan", grantedAt: e.ts, expiresAt: e.expiresAt, amount: e.amount, remaining: e.amount, seq: e.seq };
      lots.push(lot);
      byId.set(e.id, lot);
      continue;
    }
    if (e.kind === "debit" || e.kind === "hold") {
      const r = take(lots, -e.amount);
      shortfall = r2(shortfall + r.short);
      const key = e.kind === "hold" ? `hold:${e.holdId}` : e.id;
      allocations.set(key, [...(allocations.get(key) ?? []), ...r.alloc]);
      continue;
    }
    if (e.kind === "release") {
      const a = allocations.get(`hold:${e.holdId}`);
      if (a && e.amount > 0) restore(a, e.amount);
      continue;
    }
    if (e.kind === "expiry" || (e.kind === "rollover" && e.amount < 0)) {
      const lot = e.lotId ? byId.get(e.lotId) : undefined;
      if (lot) lot.remaining = r2(Math.max(0, lot.remaining + e.amount));
      else take(lots, -e.amount);
      continue;
    }
    if (e.kind === "reversal") {
      const orig = e.reverses ? kindOf.get(e.reverses) : undefined;
      if (!orig) continue;
      if (orig.kind === "debit" && e.amount > 0) {
        const a = allocations.get(orig.id);
        const left = a ? restore(a, e.amount) : e.amount;
        if (left > EPS) take(lots, -left); // nothing to restore into: ignored
      } else if (orig.kind === "expiry" && e.amount > 0) {
        const lot = orig.lotId ? byId.get(orig.lotId) : undefined;
        if (lot) lot.remaining = r2(lot.remaining + e.amount);
      } else if (e.amount < 0) {
        const lot = byId.get(orig.id);
        let need = -e.amount;
        if (lot) {
          const amt = Math.min(lot.remaining, need);
          lot.remaining = r2(lot.remaining - amt);
          need = r2(need - amt);
        }
        if (need > EPS) shortfall = r2(shortfall + take(lots, need).short);
      }
    }
  }
  return { lots, allocations, shortfall };
}

/** Remaining lots in spend order. */
export function lotsOf(ledger: LedgerEntry[], account: string, meter: string): Lot[] {
  return lotState(ledger, account, meter)
    .lots.filter((l) => l.remaining > EPS)
    .sort(compareLots);
}

// ---------------------------------------------------------------- reads

export function balanceOf(ledger: LedgerEntry[], account: string, meter: string): number {
  for (let i = ledger.length - 1; i >= 0; i--) if (ledger[i].account === account && ledger[i].meter === meter) return ledger[i].balance;
  return 0;
}

/** Usage an entry represents: debits, holds and releases, and reversals of debits. Positive = used. */
export function consumption(e: LedgerEntry): number {
  if (e.kind === "debit" || e.kind === "hold" || e.kind === "release") return -e.amount;
  if (e.kind === "reversal" && e.source === null && e.amount > 0) return -e.amount;
  return 0;
}

export function inCycle(t: TenantState, ts: string): boolean {
  return new Date(ts).getTime() >= cycleOf(t).start.getTime();
}

/** Used this cycle, counting open holds as used and releases as given back. */
export function usedThisCycle(t: TenantState, account: string, meter: string): number {
  let used = 0;
  for (const e of t.ledger) if (e.account === account && e.meter === meter && inCycle(t, e.ts)) used += consumption(e);
  return r2(used);
}

export interface HoldInfo {
  holdId: string;
  account: string;
  meter: string;
  amount: number;
  placedAt: string;
  status: "open" | "settled";
  released: number;
  extra: number;
}

/** Every hold with its status: open until a release with the same hold id closes it. */
export function holdsOf(ledger: LedgerEntry[], account?: string): HoldInfo[] {
  const out = new Map<string, HoldInfo>();
  for (const e of ledger) {
    if (!e.holdId || (account && e.account !== account)) continue;
    const k = `${e.holdId}|${e.meter}`;
    if (e.kind === "hold") out.set(k, { holdId: e.holdId, account: e.account, meter: e.meter, amount: r2((out.get(k)?.amount ?? 0) - e.amount), placedAt: e.ts, status: "open", released: 0, extra: 0 });
    const h = out.get(k);
    if (!h) continue;
    if (e.kind === "release") {
      h.status = "settled";
      h.released = r2(h.released + e.amount);
    }
    if (e.kind === "debit") h.extra = r2(h.extra - e.amount);
  }
  return [...out.values()];
}

/** Credits reserved by holds that have not been settled. */
export function heldOf(ledger: LedgerEntry[], account: string, meter: string): number {
  return r2(holdsOf(ledger, account).filter((h) => h.meter === meter && h.status === "open").reduce((s, h) => s + h.amount, 0));
}

/** Credits whose lot expires within `days` of the clock. */
export function expiringWithin(t: TenantState, account: string, meter: string, days: number): { amount: number; firstAt: string | null } {
  const limit = new Date(t.clock).getTime() + days * 86_400_000;
  const xs = lotsOf(t.ledger, account, meter).filter((l) => l.expiresAt && new Date(l.expiresAt).getTime() <= limit);
  const firstAt = xs.map((l) => l.expiresAt!).sort()[0] ?? null;
  return { amount: r2(xs.reduce((s, l) => s + l.remaining, 0)), firstAt };
}

// ---------------------------------------------------------------- operations

/** Reserve credits for a running job. Throws insufficient_balance past the policy floor. */
export function placeHold(book: Book, i: { ts: string; account: string; meter: string; amount: number; holdId: string; actor: string; eventId: string | null; note: string }): LedgerEntry {
  return book.post({ ...i, kind: "hold", amount: -Math.abs(i.amount), reason: "hold.placed", idempotencyKey: `hold:${i.holdId}:${i.meter}` });
}

/**
 * Close a hold at the job's actual cost: release the difference when it cost less, debit the
 * excess when it cost more. A release (possibly of zero) always closes the hold.
 */
export function settleHold(book: Book, i: { ts: string; account: string; meter: string; holdId: string; actual: number; actor: string; eventId: string | null; note?: string }): LedgerEntry[] {
  const h = holdsOf(book.ledger, i.account).find((x) => x.holdId === i.holdId && x.meter === i.meter);
  if (!h) throw new LedgerError("unknown_hold", `No hold ${i.holdId} on ${i.meter}`);
  if (h.status === "settled") return book.ledger.filter((e) => e.holdId === i.holdId && e.meter === i.meter && e.kind !== "hold");
  const actual = r2(Math.max(0, i.actual));
  const out: LedgerEntry[] = [];
  if (actual > h.amount + EPS) {
    out.push(book.post({ ts: i.ts, account: i.account, meter: i.meter, kind: "debit", amount: -(actual - h.amount), reason: "usage.over-hold", actor: i.actor, eventId: i.eventId, note: "Cost more than the hold", holdId: i.holdId, idempotencyKey: `hold:${i.holdId}:${i.meter}:extra` }));
  }
  const diff = r2(Math.max(0, h.amount - actual));
  out.push(
    book.post({
      ts: i.ts,
      account: i.account,
      meter: i.meter,
      kind: "release",
      amount: diff,
      reason: "hold.settled",
      actor: i.actor,
      eventId: i.eventId,
      note: i.note ?? `Finished · used ${actual} of ${h.amount} held, ${diff} released`,
      holdId: i.holdId,
      idempotencyKey: `hold:${i.holdId}:${i.meter}:settle`,
    }),
  );
  return out;
}

/** Offset an entry with an equal and opposite reversal. Holds and releases settle; they are not reversed. */
export function reverseEntry(book: Book, entryId: string, i: { ts: string; actor: string; note: string; eventId?: string | null }): LedgerEntry {
  const orig = book.ledger.find((e) => e.id === entryId);
  if (!orig) throw new LedgerError("unknown_entry", `No entry ${entryId}`);
  if (orig.kind === "reversal" || orig.kind === "hold" || orig.kind === "release") throw new LedgerError("not_reversible", `A ${orig.kind} cannot be reversed`);
  if (book.ledger.some((e) => e.kind === "reversal" && e.reverses === entryId)) throw new LedgerError("already_reversed", `${entryId} is already reversed`);
  return book.post({
    ts: i.ts,
    account: orig.account,
    meter: orig.meter,
    kind: "reversal",
    source: orig.kind === "grant" || orig.kind === "rollover" ? orig.source : null,
    amount: -orig.amount,
    reason: "correction",
    actor: i.actor,
    eventId: i.eventId ?? null,
    note: i.note,
    reverses: entryId,
    idempotencyKey: `reversal:${entryId}`,
  });
}

export function isReversed(ledger: LedgerEntry[], entryId: string): boolean {
  return ledger.some((e) => e.kind === "reversal" && e.reverses === entryId);
}

/** Post expiry entries for every lot whose date has passed by `at`. */
export function expireLots(book: Book, account: string, meter: string, at: string, actor = "system:scheduler", eventId: string | null = null): LedgerEntry[] {
  const out: LedgerEntry[] = [];
  for (const l of lotsOf(book.ledger, account, meter)) {
    if (!l.expiresAt || l.expiresAt > at) continue;
    out.push(book.post({ ts: at, account, meter, kind: "expiry", amount: -l.remaining, reason: "expiry.lot", actor, eventId, note: `${l.source === "topup" ? "Top-up" : l.source === "reward" ? "Reward" : l.source === "promo" ? "Promo" : "Allowance"} lot expired`, lotId: l.id, idempotencyKey: `expiry:${l.id}` }));
  }
  return out;
}

export interface RenewalPlan {
  close: { lotId: string; amount: number }[];
  carry: number;
  cap: number;
  over: number;
}

/**
 * Pure: which plan and rollover lots close at renewal and how much carries into the next cycle.
 * Rewards, promos and top-ups keep their own expiry and are left alone.
 */
export function renewalPlan(lots: Lot[], mode: "none" | "capped" | "full", capX: number, allowance: number): RenewalPlan {
  const eligible = lots.filter((l) => (l.source === "plan" || l.source === "rollover") && l.remaining > EPS);
  const total = r2(eligible.reduce((s, l) => s + l.remaining, 0));
  const cap = mode === "full" ? Infinity : mode === "capped" ? capX * allowance : 0;
  const carry = r2(Math.min(total, cap));
  return { close: eligible.map((l) => ({ lotId: l.id, amount: l.remaining })), carry, cap, over: r2(total - carry) };
}

/** Apply a renewal: close the eligible lots and open one rollover lot. */
export function renew(book: Book, i: { ts: string; account: string; meter: string; mode: "none" | "capped" | "full"; capX: number; allowance: number; rolloverExpiresAt: string | null; actor?: string; eventId: string | null }): RenewalPlan {
  const actor = i.actor ?? "system:renewal";
  expireLots(book, i.account, i.meter, i.ts, actor, i.eventId);
  const plan = renewalPlan(lotsOf(book.ledger, i.account, i.meter), i.mode, i.capX, i.allowance);
  for (const c of plan.close) {
    book.post({ ts: i.ts, account: i.account, meter: i.meter, kind: "expiry", amount: -c.amount, reason: "expiry.cycle-close", actor, eventId: i.eventId, note: "Closed at renewal", lotId: c.lotId, idempotencyKey: `close:${c.lotId}` });
  }
  if (plan.carry > EPS) {
    const capText = Number.isFinite(plan.cap) ? ` · cap ${r2(plan.cap)}` : "";
    book.post({ ts: i.ts, account: i.account, meter: i.meter, kind: "rollover", source: "rollover", amount: plan.carry, reason: "rollover.carry", actor, eventId: i.eventId, note: `Carried into the new cycle${capText}${plan.over > EPS ? ` · ${plan.over} over the cap expired` : ""}`, expiresAt: i.rolloverExpiresAt, idempotencyKey: `rollover:${i.account}:${i.meter}:${i.ts}` });
  }
  return plan;
}
