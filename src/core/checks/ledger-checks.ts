// Ledger rule checks (Phase 1 §1.5 and acceptance): expiry order, holds, rollover and
// reversal, plus idempotency, spend order, the never-negative policy and the hash chain.
import type { TenantPack } from "@/tenants/schema";
import type { GrantSource, LedgerEntry } from "@/core/types";
import { Book, DEFAULT_POLICY, expireLots, heldOf, holdsOf, lotsOf, placeHold, renew, renewalPlan, reverseEntry, settleHold, verifyChain, type LedgerError, type LedgerPolicy } from "@/core/ledger";
import { blockMoment } from "@/core/block";
import { runNow } from "@/core/actions";
import { seedTenant } from "@/sim/seed";
import { check, close, eq, throwsCode, type Suite } from "@/core/checks/harness";

const T = (d: number, h = 9) => new Date(Date.UTC(2026, 10, d, h)).toISOString();
const A = "acct";
const M = "dc";

function book(policy: LedgerPolicy = DEFAULT_POLICY) {
  const b = new Book([], [], policy);
  let n = 0;
  const grant = (amount: number, source: GrantSource, expiresDay: number | null, day = 1) =>
    b.post({ ts: T(day, 8), account: A, meter: M, kind: "grant", source, amount, reason: source === "topup" ? "topup.purchase" : source === "reward" ? "reward.claimed" : source === "promo" ? "promo.goodwill" : "plan.monthly", actor: "system:test", eventId: null, note: `${source} ${++n}`, expiresAt: expiresDay == null ? null : T(expiresDay, 0) });
  const debit = (amount: number, day = 2, key?: string) => b.post({ ts: T(day), account: A, meter: M, kind: "debit", amount: -amount, reason: "usage.run", actor: "user:test", eventId: null, note: `debit ${++n}`, idempotencyKey: key });
  const lots = () => lotsOf(b.ledger, A, M).map((l) => [l.source, l.remaining]);
  const bal = () => b.balance(A, M);
  return { b, grant, debit, lots, bal };
}

export function ledgerSuite(packs: TenantPack[]): Suite {
  return {
    id: "ledger",
    title: "Ledger rules",
    covers: "§1.5 · acceptance: expiry order, holds, rollover and reversal",
    cases: [
      {
        id: "kinds",
        name: "Entries are immutable kinds with an id, idempotency key, reason code and actor",
        run: () => {
          const { b, grant, debit } = book();
          grant(100, "plan", 30);
          debit(30);
          for (const e of b.ledger) check(e.id && e.idempotencyKey && e.reason && e.actor, `entry ${e.seq} is missing a field`);
          eq(b.ledger.map((e) => e.kind), ["grant", "debit"], "kinds");
          throwsCode(() => b.post({ ts: T(3), account: A, meter: M, kind: "grant", amount: -5, source: "plan", reason: "plan.monthly", actor: "x", eventId: null, note: "" }), "invalid_amount", "negative grant");
          throwsCode(() => b.post({ ts: T(3), account: A, meter: M, kind: "grant", amount: 5, reason: "plan.monthly", actor: "x", eventId: null, note: "" }), "invalid_amount", "grant without a source");
          return "grant and debit carry id, key, reason and actor; malformed postings are refused";
        },
      },
      {
        id: "idempotency",
        name: "Posting the same idempotency key twice returns the first entry",
        run: () => {
          const { b, grant, debit, bal } = book();
          grant(100, "plan", 30);
          const a = debit(10, 2, "run:42");
          const again = debit(10, 2, "run:42");
          eq(again.id, a.id, "second post returns the first entry");
          eq(b.ledger.length, 2, "entries");
          close(bal(), 90, "balance");
          throwsCode(() => debit(11, 2, "run:42"), "idempotency_conflict", "same key, different amount");
          return "duplicate ignored, conflicting reuse refused";
        },
      },
      {
        id: "spend-order",
        name: "Spend order: reward and promo first, then plan grants nearest expiry, then top-ups",
        run: () => {
          const { grant, debit, lots } = book();
          grant(50, "topup", null);
          grant(100, "plan", 30);
          grant(100, "plan", 27);
          grant(20, "reward", 40);
          grant(10, "promo", 45);
          debit(35);
          eq(lots(), [["plan", 95], ["plan", 100], ["topup", 50]], "after 35: reward 20 + promo 10 + nearest plan 5");
          debit(200, 3);
          eq(lots(), [["topup", 45]], "after 200 more: both plan lots, then 5 of the top-up");
          return "reward → promo → plan (27 Nov before 30 Nov) → top-up";
        },
      },
      {
        id: "expiry-order",
        name: "Expiry order: the lot nearest expiry is used first; expiry removes only what is left of it",
        run: () => {
          const { b, grant, debit, lots, bal } = book();
          const early = grant(60, "plan", 10);
          grant(60, "plan", 20);
          debit(45);
          const xs = expireLots(b, A, M, T(10, 1));
          eq(xs.length, 1, "expiry entries on 10 Nov");
          close(xs[0].amount, -15, "expiry amount");
          eq(xs[0].lotId, early.id, "expiry names the lot");
          eq(lots(), [["plan", 60]], "remaining lots");
          close(bal(), 60, "balance");
          eq(expireLots(b, A, M, T(10, 2)).length, 0, "nothing expires twice");
          return "45 used from the 10 Nov lot; its last 15 expired; the 20 Nov lot untouched";
        },
      },
      {
        id: "holds",
        name: "A hold reserves credits and releases the difference when the job completes",
        run: () => {
          const { b, grant, bal } = book();
          grant(100, "plan", 30);
          placeHold(b, { ts: T(2), account: A, meter: M, amount: 40, holdId: "h1", actor: "system:test", eventId: null, note: "run" });
          close(bal(), 60, "balance while held");
          close(heldOf(b.ledger, A, M), 40, "held");
          const out = settleHold(b, { ts: T(2, 10), account: A, meter: M, holdId: "h1", actual: 25, actor: "system:test", eventId: null });
          eq(out.map((e) => [e.kind, e.amount]), [["release", 15]], "settle posts the difference");
          close(bal(), 75, "balance after settle");
          close(heldOf(b.ledger, A, M), 0, "held after settle");
          eq(holdsOf(b.ledger, A)[0].status, "settled", "hold status");
          eq(settleHold(b, { ts: T(2, 11), account: A, meter: M, holdId: "h1", actual: 25, actor: "system:test", eventId: null }).length, 1, "settling twice is a no-op");
          eq(b.ledger.length, 3, "no duplicate release");
          return "held 40, used 25, released 15";
        },
      },
      {
        id: "holds-over",
        name: "A job that costs more than its hold debits the excess and closes the hold",
        run: () => {
          const { b, grant, bal } = book();
          grant(100, "plan", 30);
          placeHold(b, { ts: T(2), account: A, meter: M, amount: 20, holdId: "h2", actor: "system:test", eventId: null, note: "run" });
          const out = settleHold(b, { ts: T(2, 10), account: A, meter: M, holdId: "h2", actual: 26, actor: "system:test", eventId: null });
          eq(out.map((e) => [e.kind, e.amount]), [["debit", -6], ["release", 0]], "excess debit, zero release");
          close(bal(), 74, "balance");
          return "held 20, cost 26: debit 6, hold closed";
        },
      },
      {
        id: "holds-lots",
        name: "Released credits go back to the lots the hold drew from",
        run: () => {
          const { b, grant, lots } = book();
          grant(100, "plan", 30);
          grant(10, "reward", 12);
          placeHold(b, { ts: T(2), account: A, meter: M, amount: 30, holdId: "h3", actor: "system:test", eventId: null, note: "run" });
          eq(lots(), [["plan", 80]], "hold took the reward first, then plan");
          settleHold(b, { ts: T(2, 10), account: A, meter: M, holdId: "h3", actual: 5, actor: "system:test", eventId: null });
          eq(lots(), [["reward", 5], ["plan", 100]], "the 5 used came from the reward; plan restored");
          return "actual use stays in spend order";
        },
      },
      {
        id: "rollover",
        name: "Rollover carries unused plan credits up to the cap; top-ups, rewards and promos keep their own expiry",
        run: () => {
          const { b, grant, debit, lots } = book();
          grant(100, "plan", null);
          grant(150, "plan", null);
          grant(50, "topup", null);
          grant(10, "reward", 60);
          debit(30);
          const p = renew(b, { ts: T(30, 0), account: A, meter: M, mode: "capped", capX: 2, allowance: 100, rolloverExpiresAt: null, eventId: null });
          close(p.carry, 200, "carried");
          close(p.over, 30, "over the cap");
          eq(lots(), [["rollover", 200], ["topup", 50]], "after renewal");
          const close2 = b.ledger.filter((e) => e.reason === "expiry.cycle-close");
          eq(close2.length, 2, "both plan lots closed");
          eq(b.ledger.filter((e) => e.kind === "rollover").length, 1, "one rollover entry");
          close(renewalPlan([{ id: "x", source: "plan", grantedAt: T(1), expiresAt: null, amount: 80, remaining: 80, seq: 1 }], "none", 0, 100).carry, 0, "mode none carries nothing");
          close(renewalPlan([{ id: "x", source: "plan", grantedAt: T(1), expiresAt: null, amount: 380, remaining: 380, seq: 1 }], "full", 0, 100).carry, 380, "mode full carries all");
          return "230 unused plan credits → 200 carried (cap 2×), 30 expired; top-up kept; reward spent first";
        },
      },
      {
        id: "reversal",
        name: "A reversal offsets an entry and returns credits to the lots it used; nothing is edited",
        run: () => {
          const { b, grant, debit, lots, bal } = book();
          grant(100, "plan", 30);
          grant(10, "reward", 20);
          const d = debit(30);
          const before = JSON.stringify(b.ledger[2]);
          const r = reverseEntry(b, d.id, { ts: T(3), actor: "merchant:nia", note: "Charged twice" });
          eq([r.kind, r.amount, r.reverses, r.reason], ["reversal", 30, d.id, "correction"], "reversal entry");
          eq(JSON.stringify(b.ledger[2]), before, "original untouched");
          close(bal(), 110, "balance restored");
          eq(lots(), [["reward", 10], ["plan", 100]], "lots restored");
          throwsCode(() => reverseEntry(b, d.id, { ts: T(3), actor: "merchant:nia", note: "again" }), "already_reversed", "second reversal");
          placeHold(b, { ts: T(4), account: A, meter: M, amount: 5, holdId: "h4", actor: "system:test", eventId: null, note: "run" });
          throwsCode(() => reverseEntry(b, b.ledger[b.ledger.length - 1].id, { ts: T(4), actor: "merchant:nia", note: "x" }), "not_reversible", "holds settle, not reverse");
          check(verifyChain(b.ledger).ok, "chain still verifies");
          return "debit 30 reversed by merchant:nia; reward and plan lots restored";
        },
      },
      {
        id: "never-negative",
        name: "Balances never go negative by default; a refusal carries a typed reason a MomentCard can render",
        run: () => {
          const { b, grant, bal } = book();
          grant(10, "plan", 30);
          const err = throwsCode<LedgerError>(() => b.post({ ts: T(2), account: A, meter: M, kind: "debit", amount: -15, reason: "usage.run", actor: "user:test", eventId: null, note: "too big" }), "insufficient_balance", "debit past zero");
          eq(err.reason, { code: "insufficient_balance", meter: M, needed: 15, available: 10 }, "typed reason");
          close(bal(), 10, "balance unchanged");
          const pack = packs[0];
          check(err.reason?.code === "insufficient_balance", "reason code");
          const m = blockMoment(pack, { ...err.reason, meter: pack.meters[0].id });
          eq([m.tone, m.action.kind], ["blocked", "top-up"], "moment");
          const g = b.ledger[0];
          b.post({ ts: T(2), account: A, meter: M, kind: "debit", amount: -8, reason: "usage.run", actor: "user:test", eventId: null, note: "fits" });
          throwsCode(() => reverseEntry(b, g.id, { ts: T(3), actor: "merchant:nia", note: "x" }), "insufficient_balance", "reversing a spent grant");
          return `refused 15 with 10 available → "${m.headline}"`;
        },
      },
      {
        id: "overdraft",
        name: "A tenant can allow an overdraft; it is still capped",
        run: () => {
          const { b, grant, bal } = book({ allowNegative: true, overdraft: 20 });
          grant(10, "plan", 30);
          b.post({ ts: T(2), account: A, meter: M, kind: "debit", amount: -25, reason: "usage.run", actor: "user:test", eventId: null, note: "into overdraft" });
          close(bal(), -15, "balance");
          throwsCode(() => b.post({ ts: T(2, 10), account: A, meter: M, kind: "debit", amount: -10, reason: "usage.run", actor: "user:test", eventId: null, note: "past it" }), "insufficient_balance", "past the overdraft");
          return "−15 allowed under a 20 overdraft; −25 refused";
        },
      },
      {
        id: "chain",
        name: "The hash chain detects an edited entry",
        run: () => {
          const { b, grant, debit } = book();
          grant(100, "plan", 30);
          debit(10);
          debit(5, 3);
          check(verifyChain(b.ledger).ok, "intact chain verifies");
          const tampered: LedgerEntry[] = b.ledger.map((e, i) => (i === 1 ? { ...e, amount: -1 } : e));
          eq(verifyChain(tampered), { ok: false, brokenAt: 2 }, "edited entry");
          return "editing entry 2 breaks the chain at 2";
        },
      },
      {
        id: "seeded",
        name: "Seeded tenants follow the rules: valid entries, no negative balances, blocked runs say why",
        run: () => {
          const out: string[] = [];
          for (const pack of packs) {
            const s = seedTenant(pack, T(23, 4));
            check(verifyChain(s.ledger).ok, `${pack.id}: chain`);
            check(
              s.ledger.every((e) => e.idempotencyKey && e.reason && e.actor),
              `${pack.id}: fields`,
            );
            check(
              s.ledger.every((e) => e.balance >= -pack.ledgerPolicy.overdraft - 0.005),
              `${pack.id}: negative balance`,
            );
            const r = runNow(s, "maya", pack.demo.hub.maya.workflows[0].id).result;
            check(r.status === "ok" || r.reason != null, `${pack.id}: a stopped run has a reason`);
            out.push(`${pack.company} ${s.ledger.length} entries${r.reason ? ` · Maya's run: ${r.reason.code}` : ""}`);
          }
          return out.join(" · ");
        },
      },
    ],
  };
}
