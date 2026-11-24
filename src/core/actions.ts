// Every state change the surfaces can make. Each returns a new TenantState and leaves
// an event (and, when value moves, ledger entries) behind.
import type { TenantPack } from "@/tenants/schema";
import type { Account, Approval, Experiment, HubAccountState, TenantState } from "@/core/types";
import { Book, holdsOf, LedgerError, reverseEntry as reverseInBook, type LedgerPolicy } from "@/core/ledger";
import { CYCLE_DAYS, addDays, cycleOf, fnv1a, mulberry32, r2 } from "@/core/time";
import { attemptTopUp, executeRun, maybeAutoTopUp, type Ctx, type RunResult } from "@/core/metering";
import { monthlyAllowance, packFor, personaOf, planOf } from "@/core/pack";

function cloneHub(h: HubAccountState): HubAccountState {
  return JSON.parse(JSON.stringify(h)) as HubAccountState;
}

export function nowTs(s: TenantState): string {
  return new Date(new Date(s.clock).getTime() + (s.tick + 1) * 60_000).toISOString();
}

/** The tenant's ledger policy (Tenant Pack `ledgerPolicy`): balances stay at or above zero unless it allows an overdraft. */
export function policyOf(pack: TenantPack): LedgerPolicy {
  return pack.ledgerPolicy ?? { allowNegative: false, overdraft: 0 };
}

export function mutateHub<T>(s: TenantState, personaId: string, fn: (ctx: Ctx, ts: string) => T, actor = `user:${personaId}`): { state: TenantState; result: T } {
  const book = new Book(s.ledger, s.events, policyOf(s.pack));
  const hub = cloneHub(s.hub[personaId]);
  const ctx: Ctx = { pack: s.pack, persona: personaOf(s.pack, personaId), hub, book, rng: mulberry32(s.tick + 99), cycleStart: cycleOf(s).start, actor };
  const ts = nowTs(s);
  const result = fn(ctx, ts);
  return { state: { ...s, tick: s.tick + 1, ledger: book.ledger, events: book.events, hub: { ...s.hub, [personaId]: hub } }, result };
}

export function runNow(s: TenantState, personaId: string, workflowId: string) {
  return mutateHub(s, personaId, (ctx, ts): RunResult => {
    const w = ctx.persona.workflows.find((x) => x.id === workflowId) ?? ctx.persona.workflows[0];
    return executeRun(ctx, w, ts);
  });
}

export function buyTopUp(s: TenantState, personaId: string, meterId: string, units: number) {
  return mutateHub(s, personaId, (ctx, ts) => attemptTopUp(ctx, ts, meterId, units, false));
}

export function claimReward(s: TenantState, personaId: string, rewardId: string) {
  return mutateHub(s, personaId, (ctx, ts) => {
    const r = ctx.pack.rewards.find((x) => x.id === rewardId);
    if (!r || r.pending || ctx.hub.rewards.includes(r.id)) return false;
    ctx.hub.rewards.push(r.id);
    const ev = ctx.book.event({ ts, account: ctx.persona.id, type: "reward.claimed", status: "ok", meters: { [r.meter]: r.amount }, note: r.label });
    const expiresAt = r.expiryDays ? addDays(new Date(ts), r.expiryDays).toISOString() : null;
    ctx.book.post({ ts, account: ctx.persona.id, meter: r.meter, kind: "grant", source: "reward", amount: r.amount, reason: "reward.claimed", actor: ctx.actor, eventId: ev.id, note: r.label, expiresAt, idempotencyKey: `reward:${ctx.persona.id}:${r.id}` });
    return true;
  });
}

export function updateCard(s: TenantState, personaId: string) {
  return mutateHub(s, personaId, (ctx, ts) => {
    const exp = addDays(new Date(s.clock), 365 * 3);
    ctx.hub.card = { ...ctx.hub.card, last4: ctx.hub.card.last4 === "4471" ? "8802" : "4471", expires: `${String(exp.getMonth() + 1).padStart(2, "0")}/${String(exp.getFullYear()).slice(2)}`, status: "ok" };
    ctx.book.event({ ts, account: ctx.persona.id, type: "payment_method.updated", status: "ok", note: `${ctx.hub.card.brand} ending ${ctx.hub.card.last4} on file` });
    return true;
  });
}

export function retryCharge(s: TenantState, personaId: string, chargeId: string) {
  return mutateHub(s, personaId, (ctx, ts) => {
    const c = ctx.hub.charges.find((x) => x.id === chargeId);
    if (!c || c.status !== "failed" || ctx.hub.card.status !== "ok" || !c.meter || !c.units) return false;
    c.status = "recovered";
    c.ts = ts;
    const ev = ctx.book.event({ ts, account: ctx.persona.id, type: "payment.recovered", status: "ok", meters: { [c.meter]: c.units }, note: `$${c.amount.toFixed(2)} collected on retry` });
    const p = packFor(ctx.pack, c.meter, c.units)?.pack;
    const expiresAt = p?.validityDays ? addDays(new Date(ts), p.validityDays).toISOString() : null;
    ctx.book.post({ ts, account: ctx.persona.id, meter: c.meter, kind: "grant", source: "topup", amount: c.units, reason: "topup.recovered", actor: ctx.actor, eventId: ev.id, note: `${c.description} · recovered`, expiresAt, idempotencyKey: `topup:${c.id}` });
    ctx.hub.autoTopUpHalted = false;
    return true;
  });
}

export type LimitsPatch = Partial<Pick<HubAccountState, "topUpCap" | "mcpCap" | "budgets" | "alerts" | "autoTopUp">>;

export function setLimits(s: TenantState, personaId: string, patch: LimitsPatch, note: string) {
  return mutateHub(s, personaId, (ctx, ts) => {
    Object.assign(ctx.hub, JSON.parse(JSON.stringify(patch)) as LimitsPatch);
    ctx.hub.autoTopUpHalted = false;
    ctx.book.event({ ts, account: ctx.persona.id, type: "limit.changed", status: "info", note });
    maybeAutoTopUp(ctx, ts);
    return true;
  });
}

export function changePlan(s: TenantState, personaId: string, planId: string) {
  return mutateHub(s, personaId, (ctx, ts) => {
    const from = planOf(ctx.pack, ctx.hub.planId);
    const to = planOf(ctx.pack, planId);
    const { day, end } = cycleOf(s);
    const remaining = (CYCLE_DAYS - day) / CYCLE_DAYS;
    if ((to.price ?? 0) <= (from.price ?? 0)) {
      ctx.hub.nextPlanId = to.id;
      ctx.book.event({ ts, account: ctx.persona.id, type: "plan.change_scheduled", status: "info", note: `${from.name} → ${to.name} on ${end.toLocaleDateString("en-GB", { day: "numeric", month: "short" })}` });
      return "scheduled" as const;
    }
    ctx.hub.planId = to.id;
    ctx.hub.nextPlanId = null;
    const prorated = r2(((to.price ?? 0) - (from.price ?? 0)) * remaining);
    ctx.hub.charges.push({ id: `ch_${ctx.book.events.length + 1}_${ctx.book.ledger.length}`, ts, amount: prorated, description: `${from.name} → ${to.name}, prorated`, status: ctx.hub.card.status === "ok" ? "paid" : "failed" });
    const ev = ctx.book.event({ ts, account: ctx.persona.id, type: "plan.upgraded", status: "ok", note: `${from.name} → ${to.name} · $${prorated.toFixed(2)} prorated` });
    for (const m of ctx.pack.meters) {
      const diff = Math.round((monthlyAllowance(ctx.pack, to.id, m.id) - monthlyAllowance(ctx.pack, from.id, m.id)) * remaining);
      if (diff > 0) ctx.book.post({ ts, account: ctx.persona.id, meter: m.id, kind: "grant", source: "plan", amount: diff, reason: "plan.proration", actor: ctx.actor, eventId: ev.id, note: `${to.name} allowance, prorated`, expiresAt: end.toISOString() });
    }
    return "upgraded" as const;
  });
}

export function setStatus(s: TenantState, personaId: string, status: HubAccountState["status"], reason: string | null) {
  return mutateHub(s, personaId, (ctx, ts) => {
    const type = status === "paused" ? "subscription.paused" : status === "cancelling" ? "subscription.cancel_scheduled" : "subscription.resumed";
    ctx.hub.status = status;
    ctx.hub.cancelReason = status === "cancelling" ? reason : null;
    ctx.book.event({ ts, account: ctx.persona.id, type, status: "info", note: reason ?? (status === "active" ? "Back to active" : "") });
    return true;
  });
}

export function dismissMoment(s: TenantState, personaId: string, key: string, reason: string) {
  return mutateHub(s, personaId, (ctx, ts) => {
    ctx.hub.dismissed[key] = reason;
    ctx.book.event({ ts, account: ctx.persona.id, type: "moment.dismissed", status: "info", note: `${key} · ${reason}` });
    return true;
  });
}

/** Finish runs that are in flight: each runs against its hold, then the hold settles and releases the difference. */
export function settleHolds(s: TenantState, personaId: string) {
  return mutateHub(s, personaId, (ctx, ts) => settleOpenHolds(ctx, ts), "system:scheduler");
}

export function settleOpenHolds(ctx: Ctx, ts: string): RunResult | null {
  // Table runs in the Credits Hub manage their own holds (core/table-run.ts).
  const open = holdsOf(ctx.book.ledger, ctx.persona.id).filter((h) => h.status === "open" && !ctx.hub.runs?.some((r) => r.holdId === h.holdId));
  if (!open.length) return null;
  let result: RunResult | null = null;
  for (const holdId of new Set(open.map((h) => h.holdId))) {
    const reserved: Record<string, number> = {};
    for (const h of open) if (h.holdId === holdId) reserved[h.meter] = h.amount;
    const w = ctx.persona.workflows.find((x) => x.id === holdId.split(":")[1]);
    if (w) {
      ctx.book.event({ ts, account: ctx.persona.id, type: "hold.settling", workflow: w.name, status: "info", note: `${holdId} · running against the hold` });
      result = executeRun(ctx, w, ts, { holdId, reserved });
    } else {
      for (const [m, v] of Object.entries(reserved)) ctx.book.post({ ts, account: ctx.persona.id, meter: m, kind: "release", amount: v, reason: "hold.settled", actor: ctx.actor, eventId: null, note: "Job no longer exists · hold released", holdId, idempotencyKey: `hold:${holdId}:${m}:settle` });
    }
  }
  return result;
}

/** Offset a ledger entry with a reversal (a correction). Returns an error message instead of throwing. */
export function reverseLedgerEntry(s: TenantState, entryId: string, actor: string, note: string): { state: TenantState; error: string | null } {
  const book = new Book(s.ledger, s.events, policyOf(s.pack));
  const orig = s.ledger.find((e) => e.id === entryId);
  try {
    const ev = book.event({ ts: nowTs(s), account: orig?.account ?? "tenant", type: "ledger.reversed", status: "info", note: `${entryId} · ${note}` });
    reverseInBook(book, entryId, { ts: nowTs(s), actor, note, eventId: ev.id });
  } catch (e) {
    return { state: s, error: e instanceof LedgerError ? e.message : "The reversal could not be posted." };
  }
  return { state: { ...s, tick: s.tick + 1, ledger: book.ledger, events: book.events }, error: null };
}

/** Grant promo credits (spent first, with their own expiry), e.g. as goodwill after a help chat. */
export function grantPromo(s: TenantState, personaId: string, meterId: string, amount: number, note: string, actor: string, expiryDays = 30) {
  return mutateHub(
    s,
    personaId,
    (ctx, ts) => {
      const ev = ctx.book.event({ ts, account: ctx.persona.id, type: "promo.granted", status: "ok", meters: { [meterId]: amount }, note });
      return ctx.book.post({ ts, account: ctx.persona.id, meter: meterId, kind: "grant", source: "promo", amount, reason: "promo.goodwill", actor, eventId: ev.id, note, expiresAt: addDays(new Date(ts), expiryDays).toISOString() });
    },
    actor,
  );
}

/** Change the account's billing region (currency, tax display and payment prompts). */
export function setRegion(s: TenantState, personaId: string, region: string, name: string) {
  return mutateHub(s, personaId, (ctx, ts) => {
    ctx.hub.region = region;
    ctx.book.event({ ts, account: ctx.persona.id, type: "account.region_changed", status: "info", note: `Billing region · ${name}` });
    return true;
  });
}

/** Record consent to recurring charges (auto top-up) under a region's rules. */
export function recordConsent(s: TenantState, personaId: string, region: string, maxPerCharge: number | null, note: string) {
  return mutateHub(s, personaId, (ctx, ts) => {
    ctx.hub.consents = { ...ctx.hub.consents, [region]: { at: ts, maxPerCharge } };
    ctx.book.event({ ts, account: ctx.persona.id, type: "consent.recurring_given", status: "info", note });
    return true;
  });
}

/** Log the outcome of a strong-authentication prompt before a card payment. */
export function recordPaymentAuth(s: TenantState, personaId: string, outcome: "approved" | "cancelled" | "exempt", note: string) {
  return mutateHub(s, personaId, (ctx, ts) => {
    ctx.book.event({ ts, account: ctx.persona.id, type: outcome === "approved" ? "payment.authenticated" : outcome === "cancelled" ? "payment.auth_cancelled" : "payment.auth_exempt", status: outcome === "cancelled" ? "stopped" : "info", note });
    return true;
  });
}

export function logTenantEvent(s: TenantState, type: string, note: string, account = "tenant"): TenantState {
  const book = new Book(s.ledger, s.events, policyOf(s.pack));
  book.event({ ts: nowTs(s), account, type, status: "info", note });
  return { ...s, tick: s.tick + 1, events: book.events };
}

export function updatePack(s: TenantState, fn: (p: TenantPack) => void, note: string): TenantState {
  const pack = JSON.parse(JSON.stringify(s.pack)) as TenantPack;
  fn(pack);
  return logTenantEvent({ ...s, pack }, "pack.updated", note);
}

export function updateExperiments(s: TenantState, fn: (xs: Experiment[]) => Experiment[], note: string): TenantState {
  return logTenantEvent({ ...s, experiments: fn(s.experiments.map((e) => ({ ...e, arms: e.arms.map((a) => ({ ...a })) }))) }, "experiment.updated", note);
}

export function setSave(s: TenantState, account: Account, play: string | null, label: string): TenantState {
  const saves = { ...s.saves };
  if (play) saves[account.id] = play;
  else delete saves[account.id];
  return logTenantEvent({ ...s, saves }, play ? "save.applied" : "save.removed", `${account.name} · ${label}`, account.id);
}

/** Approvals carry an audit id derived from what was approved, so the same change has the same id. */
export function auditId(subject: string, ts: string): string {
  return `aud_${fnv1a(`${subject}|${ts}`)}`;
}

/** `at` pins the timestamp so an id shown before approving matches the one recorded. */
export function recordApproval(s: TenantState, a: Omit<Approval, "id" | "ts">, subject: string, at?: string): { state: TenantState; approval: Approval } {
  const ts = at ?? nowTs(s);
  const approval: Approval = { ...a, id: auditId(subject, ts), ts };
  const next = logTenantEvent({ ...s, approvals: [approval, ...s.approvals] }, `approval.${a.decision}`, `${a.title} · ${approval.id}`);
  return { state: next, approval };
}

