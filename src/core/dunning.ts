// Payment failure and involuntary-churn arrest: pre-expiry warning, backup-method fallback,
// a soft landing (credits keep working through a grace window), a transparent retry
// timeline, and runs pausing only after grace ends. Data export is never blocked.
import type { DunningState, HubAccountState, TenantState } from "@/core/types";
import type { Ctx } from "@/core/metering";
import { mutateHub } from "@/core/actions";
import { addDays, DAY_MS, r2 } from "@/core/time";
import { planOf } from "@/core/pack";

export type Card = HubAccountState["card"];

export const NO_DUNNING: DunningState = { status: "ok", invoiceId: null, amount: 0, failedAt: null, graceUntil: null, attempts: [] };

/** "MM/YY" → the last moment of that month. */
export function cardExpiresAt(card: Card): Date | null {
  const m = /^(\d{2})\/(\d{2})$/.exec(card.expires);
  if (!m) return null;
  return new Date(Date.UTC(2000 + Number(m[2]), Number(m[1]), 0, 23, 59, 59));
}

export const cardLabel = (c: Card) => `${c.brand} ending ${c.last4}`;

export function cardUsable(c: Card | null, at: string | Date): boolean {
  if (!c || c.status !== "ok") return false;
  const exp = cardExpiresAt(c);
  return !exp || exp.getTime() >= new Date(at).getTime();
}

export interface PreExpiry {
  which: "primary" | "backup";
  card: Card;
  expiresAt: string;
  daysLeft: number;
}

/** A card that expires within the pre-expiry window (default 30 days), primary first. */
export function preExpiry(hub: HubAccountState, clock: string, windowDays: number): PreExpiry | null {
  const now = new Date(clock).getTime();
  for (const [which, card] of [["primary", hub.card], ["backup", hub.backupCard]] as const) {
    if (!card || card.status !== "ok") continue;
    const exp = cardExpiresAt(card);
    if (!exp) continue;
    const daysLeft = Math.ceil((exp.getTime() - now) / DAY_MS);
    if (daysLeft >= 0 && daysLeft <= windowDays) return { which, card, expiresAt: exp.toISOString(), daysLeft };
  }
  return null;
}

/** Try the primary method, then the backup. Returns the method that paid, or null. */
function charge(hub: HubAccountState, ts: string, attempts: DunningState["attempts"], amount: number): string | null {
  if (cardUsable(hub.card, ts)) {
    attempts.push({ at: ts, method: cardLabel(hub.card), outcome: "paid", note: `$${amount.toFixed(2)} collected` });
    return cardLabel(hub.card);
  }
  attempts.push({ at: ts, method: cardLabel(hub.card), outcome: "failed", note: hub.card.status === "expired" ? "Card expired" : "Declined by the bank" });
  if (hub.backupCard && cardUsable(hub.backupCard, ts)) {
    attempts.push({ at: ts, method: `Backup ${cardLabel(hub.backupCard)}`, outcome: "paid", note: `$${amount.toFixed(2)} collected from the backup method` });
    return `backup ${cardLabel(hub.backupCard)}`;
  }
  if (hub.backupCard) attempts.push({ at: ts, method: `Backup ${cardLabel(hub.backupCard)}`, outcome: "failed", note: "Backup also declined" });
  return null;
}

/** A renewal invoice could not be collected: start the soft landing and schedule retries. */
export function startDunning(ctx: Ctx, ts: string, invoiceId: string, amount: number) {
  const attempts: DunningState["attempts"] = [];
  const paidBy = charge(ctx.hub, ts, attempts, amount);
  const inv = ctx.hub.charges.find((c) => c.id === invoiceId);
  if (paidBy) {
    if (inv) {
      inv.status = "paid";
      inv.reason = paidBy.startsWith("backup") ? `Primary card failed; paid by ${paidBy}` : undefined;
    }
    ctx.hub.dunning = { status: paidBy.startsWith("backup") ? "recovered" : "ok", invoiceId, amount, failedAt: paidBy.startsWith("backup") ? ts : null, graceUntil: null, attempts: paidBy.startsWith("backup") ? attempts : [] };
    if (paidBy.startsWith("backup")) ctx.book.event({ ts, account: ctx.persona.id, type: "payment.fallback", status: "ok", note: `Renewal $${amount.toFixed(2)} paid by ${paidBy}` });
    return;
  }
  const grace = ctx.pack.hub.dunning.graceDays;
  const graceUntil = addDays(new Date(ts), grace).toISOString();
  for (const d of ctx.pack.hub.dunning.retryDays) if (d > 0 && d <= grace) attempts.push({ at: addDays(new Date(ts), d).toISOString(), method: "Card on file, then backup", outcome: "scheduled", note: `Smart retry, day ${d}` });
  if (inv) {
    inv.status = "failed";
    inv.reason = attempts[0]?.note;
  }
  ctx.hub.dunning = { status: "grace", invoiceId, amount, failedAt: ts, graceUntil, attempts };
  ctx.book.event({ ts, account: ctx.persona.id, type: "payment.failed", status: "failed", note: `Renewal $${amount.toFixed(2)} not collected · credits keep working until ${new Date(graceUntil).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}` });
}

function settle(ctx: Ctx, ts: string, paidBy: string) {
  const d = ctx.hub.dunning;
  const inv = ctx.hub.charges.find((c) => c.id === d.invoiceId);
  if (inv) {
    inv.status = "recovered";
    inv.reason = `Recovered ${new Date(ts).toLocaleDateString("en-GB", { day: "numeric", month: "short" })} via ${paidBy}`;
  }
  d.attempts = d.attempts.map((a) => (a.outcome === "scheduled" ? { ...a, outcome: "skipped", note: "Not needed: already paid" } : a));
  d.status = "recovered";
  ctx.book.event({ ts, account: ctx.persona.id, type: "payment.recovered", status: "ok", note: `Renewal $${d.amount.toFixed(2)} collected via ${paidBy}` });
}

/** Run the retries that are due by `ts`; end the grace window when it has passed unpaid. */
export function advanceDunning(ctx: Ctx, ts: string) {
  const d = ctx.hub.dunning;
  if (d.status !== "grace") return;
  const now = new Date(ts).getTime();
  for (const a of d.attempts) {
    if (a.outcome !== "scheduled" || new Date(a.at).getTime() > now) continue;
    const tried: DunningState["attempts"] = [];
    const paidBy = charge(ctx.hub, a.at, tried, d.amount);
    a.outcome = paidBy ? "paid" : "failed";
    a.method = tried[tried.length - 1]?.method ?? a.method;
    a.note = paidBy ? `Collected via ${paidBy}` : tried.map((x) => `${x.method}: ${x.note}`).join("; ");
    if (paidBy) return settle(ctx, a.at, paidBy);
  }
  if (d.graceUntil && now >= new Date(d.graceUntil).getTime()) {
    d.status = "suspended";
    d.attempts = d.attempts.map((a) => (a.outcome === "scheduled" ? { ...a, outcome: "skipped", note: "Grace window ended" } : a));
    ctx.book.event({ ts, account: ctx.persona.id, type: "payment.grace_ended", status: "blocked", note: "Runs paused until the renewal is paid · exports stay open" });
  }
}

/** One-tap retry from the banner (after a card update, say). */
export function retryRenewal(s: TenantState, account: string) {
  return mutateHub(s, account, (ctx, ts) => {
    const d = ctx.hub.dunning;
    if (d.status !== "grace" && d.status !== "suspended") return false;
    const tried: DunningState["attempts"] = [];
    const paidBy = charge(ctx.hub, ts, tried, d.amount);
    d.attempts.push(...tried.map((a) => ({ ...a, note: `${a.note} · retried by you` })));
    if (paidBy) {
      settle(ctx, ts, paidBy);
      return true;
    }
    return false;
  });
}

export type PaymentScenario = "card-expiring" | "renewal-fails-backup" | "renewal-fails" | "grace-ends" | "clear";

export const PAYMENT_SCENARIOS: { id: PaymentScenario; label: string; detail: string }[] = [
  { id: "card-expiring", label: "Card expires within 30 days", detail: "Shows the pre-expiry banner with one-tap update" },
  { id: "renewal-fails-backup", label: "Renewal fails, backup pays", detail: "Primary card declines; the backup method is charged automatically" },
  { id: "renewal-fails", label: "Renewal fails, no backup", detail: "Soft landing: credits keep working through the grace window, retries scheduled" },
  { id: "grace-ends", label: "Grace window ends unpaid", detail: "Runs pause; usage, invoices and exports stay open" },
  { id: "clear", label: "Clear payment state", detail: "Valid card on file, nothing owed" },
];

/** Put an account into a payment state, for the demo and the journeys. */
export function paymentScenario(s: TenantState, account: string, scenario: PaymentScenario) {
  return mutateHub(
    s,
    account,
    (ctx, ts) => {
      const hub = ctx.hub;
      const plan = planOf(ctx.pack, hub.planId);
      const amount = plan.price ?? 0;
      const exp = (days: number) => {
        const d = addDays(new Date(ts), days);
        return `${String(d.getUTCMonth() + 1).padStart(2, "0")}/${String(d.getUTCFullYear()).slice(2)}`;
      };
      const invoice = () => {
        const id = `ch_inv_sim_${hub.charges.length + 1}`;
        hub.charges.push({ id, ts, amount, description: `${plan.name} plan · renewal`, status: "failed" });
        return id;
      };
      switch (scenario) {
        case "card-expiring":
          hub.card = { ...hub.card, status: "ok", expires: exp(20) };
          hub.dunning = { ...NO_DUNNING };
          break;
        case "renewal-fails-backup":
          hub.card = { ...hub.card, status: "expired" };
          hub.backupCard = hub.backupCard ? { ...hub.backupCard, status: "ok", expires: exp(400) } : { brand: "Visa", last4: "7781", expires: exp(400), status: "ok" };
          startDunning(ctx, ts, invoice(), amount);
          break;
        case "renewal-fails":
          hub.card = { ...hub.card, status: "expired" };
          hub.backupCard = null;
          startDunning(ctx, ts, invoice(), amount);
          break;
        case "grace-ends": {
          if (hub.dunning.status !== "grace") {
            hub.card = { ...hub.card, status: "expired" };
            hub.backupCard = null;
            startDunning(ctx, addDays(new Date(ts), -ctx.pack.hub.dunning.graceDays - 1).toISOString(), invoice(), amount);
          } else {
            hub.dunning.graceUntil = addDays(new Date(ts), -1).toISOString();
            hub.dunning.attempts = hub.dunning.attempts.map((a) => (a.outcome === "scheduled" ? { ...a, at: addDays(new Date(ts), -2).toISOString() } : a));
          }
          advanceDunning(ctx, ts);
          break;
        }
        case "clear":
          hub.card = { ...hub.card, status: "ok", expires: exp(900) };
          hub.dunning = { ...NO_DUNNING };
          for (const c of hub.charges) if (c.status === "failed" && !c.meter) c.status = "recovered";
          break;
      }
      ctx.book.event({ ts, account, type: "sim.payment_state", status: "info", note: PAYMENT_SCENARIOS.find((x) => x.id === scenario)?.label ?? scenario });
      return r2(amount);
    },
    "system:scenario",
  );
}
