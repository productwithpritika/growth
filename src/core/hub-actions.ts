// Credits Hub actions added in Phase 2. Each returns a new TenantState, leaves an event behind,
// writes an audit entry for configuration changes, and posts ledger entries when value moves.
import type { AuditEntry, CreditRequest, ExitSurvey, HubAccountState, Notice, PlanChange, SpendLimit, TeamRole, TenantState } from "@/core/types";
import { mutateHub } from "@/core/actions";
import { attemptTopUp, maybeAutoTopUp, type Ctx } from "@/core/metering";
import { LedgerError, lotsOf, reverseEntry } from "@/core/ledger";
import { CYCLE_DAYS, addDays, cycleOf, fnv1a, r2 } from "@/core/time";
import { meterOf, monthlyAllowance, packFor, planOf, primaryMeter, topUpUnitPrice } from "@/core/pack";
import { auditEntry, memberName, ROLE_LABEL } from "@/core/team";
import { awardBadge } from "@/core/rewards-program";
import { retryRenewal } from "@/core/dunning";

const fmt$ = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 })}`;

function notify(hub: HubAccountState, ts: string, n: Omit<Notice, "id" | "ts">) {
  hub.notices.push({ id: `nt_${hub.notices.length + 1}_${fnv1a(ts + n.subject).slice(0, 4)}`, ts, ...n });
}

function admins(hub: HubAccountState, includeBilling = true) {
  return hub.team.filter((m) => m.role === "admin" || (includeBilling && m.role === "billing"));
}

// ---------------------------------------------------------------- governance

export function upsertLimit(s: TenantState, account: string, limit: SpendLimit, actor: string, label: string) {
  return mutateHub(
    s,
    account,
    (ctx, ts) => {
      const i = ctx.hub.limits.findIndex((l) => l.id === limit.id);
      const m = meterOf(ctx.pack, limit.meter);
      const before = i >= 0 ? `${ctx.hub.limits[i].amount} ${m.label} · ${ctx.hub.limits[i].behaviour}` : null;
      if (i >= 0) ctx.hub.limits[i] = { ...limit };
      else ctx.hub.limits.push({ ...limit });
      auditEntry(ctx.hub, ts, actor, "limits", `${label} limit`, before, `${limit.amount} ${m.label} · ${limit.behaviour}`);
      ctx.book.event({ ts, account, type: "limit.changed", status: "info", note: `${label}: ${limit.amount} ${m.label}, ${limit.behaviour}` });
      return true;
    },
    actor,
  );
}

export function removeLimit(s: TenantState, account: string, id: string, actor: string, label: string) {
  return mutateHub(
    s,
    account,
    (ctx, ts) => {
      const l = ctx.hub.limits.find((x) => x.id === id);
      if (!l) return false;
      ctx.hub.limits = ctx.hub.limits.filter((x) => x.id !== id);
      auditEntry(ctx.hub, ts, actor, "limits", `${label} limit removed`, `${l.amount} ${meterOf(ctx.pack, l.meter).label} · ${l.behaviour}`, null);
      ctx.book.event({ ts, account, type: "limit.changed", status: "info", note: `${label} limit removed` });
      return true;
    },
    actor,
  );
}

export function setRole(s: TenantState, account: string, memberId: string, role: TeamRole, actor: string) {
  return mutateHub(
    s,
    account,
    (ctx, ts) => {
      const m = ctx.hub.team.find((x) => x.id === memberId);
      if (!m || m.role === role) return false;
      if (m.role === "admin" && ctx.hub.team.filter((x) => x.role === "admin").length === 1) return false;
      auditEntry(ctx.hub, ts, actor, "roles", `${m.name}'s role`, ROLE_LABEL[m.role], ROLE_LABEL[role]);
      m.role = role;
      ctx.book.event({ ts, account, type: "role.changed", status: "info", note: `${m.name} is now ${ROLE_LABEL[role]}` });
      return true;
    },
    actor,
  );
}

export function setAlertSettings(s: TenantState, account: string, patch: { channels?: HubAccountState["alertChannels"]; alerts?: Record<string, boolean> }, actor: string) {
  return mutateHub(
    s,
    account,
    (ctx, ts) => {
      const on = (r: Record<string, boolean>) => Object.entries(r).filter(([, v]) => v).map(([k]) => k).join(", ") || "none";
      if (patch.channels) {
        auditEntry(ctx.hub, ts, actor, "alerts", "Alert channels", on(ctx.hub.alertChannels), on(patch.channels));
        ctx.hub.alertChannels = { ...patch.channels };
      }
      if (patch.alerts) {
        auditEntry(ctx.hub, ts, actor, "alerts", "Usage alerts", on(ctx.hub.alerts).replace(/(\d+)/g, "$1%"), on(patch.alerts).replace(/(\d+)/g, "$1%"));
        ctx.hub.alerts = { ...patch.alerts };
      }
      ctx.book.event({ ts, account, type: "alerts.changed", status: "info", note: "Alert settings saved" });
      return true;
    },
    actor,
  );
}

// ---------------------------------------------------------------- credit requests

export function requestCredits(s: TenantState, account: string, from: { id: string; name: string }, meter: string, amount: number, reason: string) {
  return mutateHub(
    s,
    account,
    (ctx, ts) => {
      const m = meterOf(ctx.pack, meter);
      const usd = r2(amount * topUpUnitPrice(ctx.pack, meter));
      const req: CreditRequest = { id: `rq_${ctx.hub.requests.length + 1}_${fnv1a(ts).slice(0, 4)}`, ts, from: from.id, fromName: from.name, meter, amount, usd, reason, status: "pending", decidedAt: null, decidedBy: null, note: null };
      ctx.hub.requests.push(req);
      const body = `${from.name} asks for ${amount.toLocaleString("en-US")} ${m.label} (about ${fmt$(usd)}): "${reason}"`;
      for (const a of admins(ctx.hub)) {
        if (ctx.hub.alertChannels.email) notify(ctx.hub, ts, { channel: "email", to: a.name, subject: `${from.name} requested ${amount.toLocaleString("en-US")} ${m.label}`, body, action: "Approve" });
      }
      if (ctx.hub.alertChannels.chat) notify(ctx.hub, ts, { channel: "chat", to: "#revops-billing", subject: "Credit request", body, action: "Approve" });
      notify(ctx.hub, ts, { channel: "inapp", to: "Admins", subject: "Credit request", body, action: "Approve" });
      ctx.book.event({ ts, account, type: "credits.requested", status: "info", member: from.id, meters: { [meter]: amount }, note: body });
      return req.id;
    },
    `member:${from.id}`,
  );
}

/** One-tap approve: raises the member's blocking limit by the amount and tops up what the balance can't cover. */
export function decideRequest(s: TenantState, account: string, requestId: string, approve: boolean, actor: string) {
  return mutateHub(
    s,
    account,
    (ctx, ts): { ok: boolean; note: string } => {
      const r = ctx.hub.requests.find((x) => x.id === requestId);
      if (!r || r.status !== "pending") return { ok: false, note: "That request was already decided." };
      const m = meterOf(ctx.pack, r.meter);
      r.decidedAt = ts;
      r.decidedBy = actor;
      if (!approve) {
        r.status = "declined";
        r.note = "Declined";
        notify(ctx.hub, ts, { channel: "inapp", to: r.fromName, subject: "Credit request declined", body: `${memberName(ctx.hub, actor.split(":")[1] ?? "")} declined your request for ${r.amount.toLocaleString("en-US")} ${m.label}.`, action: null });
        auditEntry(ctx.hub, ts, actor, "requests", `${r.fromName}'s request for ${r.amount} ${m.label}`, "Pending", "Declined");
        ctx.book.event({ ts, account, type: "credits.declined", status: "info", member: r.from, note: `${r.fromName}'s request declined` });
        return { ok: true, note: "Declined." };
      }
      const parts: string[] = [];
      const lim = ctx.hub.limits.find((l) => l.scope === "member" && l.target === r.from && l.meter === r.meter);
      if (lim) {
        auditEntry(ctx.hub, ts, actor, "limits", `${r.fromName}'s limit (approved request)`, `${lim.amount} ${m.label}`, `${lim.amount + r.amount} ${m.label}`);
        lim.amount = r2(lim.amount + r.amount);
        parts.push(`${r.fromName}'s limit is now ${lim.amount.toLocaleString("en-US")} ${m.label}`);
      }
      const short = r2(r.amount - ctx.book.spendable(account, r.meter));
      if (short > 0) {
        const c = attemptTopUp(ctx, ts, r.meter, short, false);
        if (!c || c.status === "failed") {
          r.status = "pending";
          r.decidedAt = null;
          r.decidedBy = null;
          return { ok: false, note: c ? `The top-up was declined (${c.reason}). Update the card, then approve again.` : `${m.label} top-ups aren't available on this plan.` };
        }
        parts.push(`${(c.units ?? 0).toLocaleString("en-US")} ${m.label} added for ${fmt$(c.amount)}`);
      }
      r.status = "approved";
      r.note = parts.join("; ") || "Approved: the workspace balance already covers it";
      notify(ctx.hub, ts, { channel: "inapp", to: r.fromName, subject: "Credit request approved", body: r.note, action: null });
      if (ctx.hub.alertChannels.chat) notify(ctx.hub, ts, { channel: "chat", to: "#revops-billing", subject: "Approved", body: `${r.fromName}'s request approved · ${r.note}`, action: null });
      auditEntry(ctx.hub, ts, actor, "requests", `${r.fromName}'s request for ${r.amount} ${m.label}`, "Pending", "Approved");
      ctx.book.event({ ts, account, type: "credits.approved", status: "ok", member: r.from, note: r.note });
      return { ok: true, note: r.note };
    },
    actor,
  );
}

// ---------------------------------------------------------------- top-ups

/** Price for a custom amount: the per-credit price of the largest pack it reaches (packs fall in price as they grow). */
export function customTopUpPrice(pack: TenantState["pack"], meterId: string, units: number): { usd: number; perUnit: number } | null {
  const packs = pack.topUpPacks.filter((p) => p.meter === meterId).sort((a, b) => a.units - b.units);
  if (!packs.length) return null;
  const tier = [...packs].reverse().find((p) => units >= p.units) ?? packs[0];
  const perUnit = tier.price / tier.units;
  return { usd: r2(units * perUnit), perUnit };
}

export function buyCustomTopUp(s: TenantState, account: string, meterId: string, units: number, actor: string) {
  return mutateHub(
    s,
    account,
    (ctx, ts) => {
      const q = customTopUpPrice(ctx.pack, meterId, units);
      const m = meterOf(ctx.pack, meterId);
      if (!q) return null;
      const tier = ctx.pack.topUpPacks.filter((p) => p.meter === meterId).sort((a, b) => b.units - a.units).find((p) => units >= p.units) ?? ctx.pack.topUpPacks.find((p) => p.meter === meterId);
      const card = ctx.hub.card.status === "ok" ? ctx.hub.card : ctx.hub.backupCard?.status === "ok" ? ctx.hub.backupCard : null;
      const id = `ch_${ctx.book.events.length + 1}_${ctx.book.ledger.length}`;
      if (!card) {
        ctx.hub.charges.push({ id, ts, amount: q.usd, description: `${units.toLocaleString("en-US")} ${m.label} · custom`, status: "failed", meter: meterId, units, reason: `${ctx.hub.card.brand} ending ${ctx.hub.card.last4} expired` });
        return { ok: false, id };
      }
      ctx.hub.charges.push({ id, ts, amount: q.usd, description: `${units.toLocaleString("en-US")} ${m.label} · custom`, status: "paid", meter: meterId, units, reason: card === ctx.hub.backupCard ? `Paid with backup ${card.brand} ending ${card.last4}` : undefined });
      const ev = ctx.book.event({ ts, account, type: "topup.purchased", status: "ok", meters: { [meterId]: units }, note: `$${q.usd.toFixed(2)} charged to ${card.brand} ending ${card.last4}` });
      ctx.book.post({ ts, account, meter: meterId, kind: "grant", source: "topup", amount: units, reason: "topup.purchase", actor, eventId: ev.id, note: `${units.toLocaleString("en-US")} ${m.label} · custom top-up`, expiresAt: tier?.validityDays ? addDays(new Date(ts), tier.validityDays).toISOString() : null, idempotencyKey: `topup:${id}` });
      return { ok: true, id };
    },
    actor,
  );
}

// ---------------------------------------------------------------- auto top-up

export function saveAutoTopUp(s: TenantState, account: string, cfg: HubAccountState["autoTopUp"], topUpCap: number, actor: string) {
  return mutateHub(
    s,
    account,
    (ctx, ts) => {
      const before = ctx.hub.autoTopUp;
      const m = meterOf(ctx.pack, cfg.meter);
      const desc = (a: HubAccountState["autoTopUp"], cap: number) => (a.enabled ? `below ${a.threshold} add ${a.units} ${m.label}; cap ${fmt$(cap)}; at cap ${a.atCap}; on failure ${a.onFail}` : "off");
      auditEntry(ctx.hub, ts, actor, "auto top-up", "Auto top-up", desc(before, ctx.hub.topUpCap), desc(cfg, topUpCap));
      ctx.hub.autoTopUp = { ...cfg };
      ctx.hub.topUpCap = topUpCap;
      ctx.hub.autoTopUpHalted = false;
      ctx.hub.capAsk = null;
      ctx.book.event({ ts, account, type: "limit.changed", status: "info", note: `Auto top-up ${cfg.enabled ? "on" : "off"} · cap ${fmt$(topUpCap)}` });
      maybeAutoTopUp(ctx, ts);
      return true;
    },
    actor,
  );
}

/** The last automatic top-up, if it is recent and untouched enough to refund. */
export function refundableAutoTopUp(t: TenantState, account: string): { chargeId: string; entryId: string; units: number; amount: number; meter: string } | null {
  const hub = t.hub[account];
  const c = [...hub.charges].reverse().find((x) => x.meter && x.status === "paid" && x.description.includes("auto top-up"));
  if (!c || !c.meter || !c.units) return null;
  if (new Date(t.clock).getTime() + 3_600_000 * 2 - new Date(c.ts).getTime() > 24 * 3_600_000) return null;
  const e = t.ledger.find((x) => x.idempotencyKey === `topup:${c.id}`);
  if (!e) return null;
  const lot = lotsOf(t.ledger, account, c.meter).find((l) => l.id === e.id);
  if (!lot || lot.remaining + 1e-6 < lot.amount) return null;
  return { chargeId: c.id, entryId: e.id, units: c.units, amount: c.amount, meter: c.meter };
}

/** "I changed my mind": pause auto top-up (until a date, or until turned back on) and refund the last one if its credits are untouched. */
export function changedMyMind(s: TenantState, account: string, days: number | null, refund: boolean, actor: string) {
  const r = refund ? refundableAutoTopUp(s, account) : null;
  return mutateHub(
    s,
    account,
    (ctx, ts) => {
      const until = days == null ? null : addDays(new Date(ts), days).toISOString();
      auditEntry(ctx.hub, ts, actor, "auto top-up", "Auto top-up paused", "On", until ? `Paused until ${new Date(until).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}` : "Off");
      if (until) ctx.hub.autoTopUp = { ...ctx.hub.autoTopUp, pausedUntil: until };
      else ctx.hub.autoTopUp = { ...ctx.hub.autoTopUp, enabled: false, pausedUntil: null };
      let refunded = 0;
      if (r) {
        try {
          reverseEntry(ctx.book, r.entryId, { ts, actor, note: "Auto top-up refunded: changed my mind within 24 hours" });
          const c = ctx.hub.charges.find((x) => x.id === r.chargeId);
          if (c) {
            c.status = "refunded";
            c.reason = "Refunded within 24 hours, credits unused";
          }
          refunded = r.amount;
        } catch (e) {
          if (!(e instanceof LedgerError)) throw e;
        }
      }
      ctx.book.event({ ts, account, type: "topup.paused", status: "info", note: `Auto top-up ${until ? "paused" : "turned off"}${refunded ? ` · ${fmt$(refunded)} refunded` : ""}` });
      return refunded;
    },
    actor,
  );
}

export function resumeAutoTopUp(s: TenantState, account: string, actor: string) {
  return mutateHub(
    s,
    account,
    (ctx, ts) => {
      auditEntry(ctx.hub, ts, actor, "auto top-up", "Auto top-up", "Paused", "On");
      ctx.hub.autoTopUp = { ...ctx.hub.autoTopUp, enabled: true, pausedUntil: null };
      ctx.hub.autoTopUpHalted = false;
      ctx.book.event({ ts, account, type: "topup.resumed", status: "info", note: "Auto top-up back on" });
      maybeAutoTopUp(ctx, ts);
      return true;
    },
    actor,
  );
}

/** At the cap with "ask": the admin allows exactly one more pack this cycle. */
export function allowOneMore(s: TenantState, account: string, actor: string) {
  return mutateHub(
    s,
    account,
    (ctx, ts) => {
      const ask = ctx.hub.capAsk;
      if (!ask) return null;
      const before = ctx.hub.topUpCap;
      ctx.hub.topUpCap = r2(before + ask.usd);
      ctx.hub.capAsk = null;
      ctx.hub.autoTopUpHalted = false;
      auditEntry(ctx.hub, ts, actor, "auto top-up", "Monthly top-up cap (one more pack)", fmt$(before), fmt$(ctx.hub.topUpCap));
      maybeAutoTopUp(ctx, ts);
      return ctx.hub.topUpCap;
    },
    actor,
  );
}

// ---------------------------------------------------------------- plan change

export interface PlanConfig {
  planId: string;
  billing: "monthly" | "annual";
  addOns: Record<string, number>;
}

export function configMonthly(t: Pick<TenantState, "pack">, cfg: PlanConfig): number | null {
  const plan = planOf(t.pack, cfg.planId);
  if (plan.price == null) return null;
  let p = plan.price;
  for (const [m, n] of Object.entries(cfg.addOns)) p += (t.pack.hub.expansion[m]?.price ?? 0) * n;
  return r2(cfg.billing === "annual" ? p * (1 - t.pack.hub.annualDiscountPct / 100) : p);
}

export function configAllowance(t: Pick<TenantState, "pack">, cfg: Pick<PlanConfig, "planId" | "addOns">, meter: string): number {
  return monthlyAllowance(t.pack, cfg.planId, meter) + (t.pack.hub.expansion[meter]?.step ?? 0) * (cfg.addOns[meter] ?? 0);
}

export interface PlanPreview {
  from: PlanConfig;
  to: PlanConfig;
  fromMonthly: number | null;
  toMonthly: number | null;
  annualTotal: number | null;
  direction: "up" | "down" | "same";
  effective: "now" | "renewal";
  effectiveDate: string;
  /** Charged today: the new price for the days left, less the unused part of the current one. */
  prorationUsd: number;
  daysLeft: number;
  grantsNow: Record<string, number>;
  nextInvoiceUsd: number | null;
  undoHours: number;
  custom: boolean;
}

export function currentConfig(t: TenantState, account: string): PlanConfig {
  const h = t.hub[account];
  return { planId: h.planId, billing: h.profile.billing, addOns: { ...h.profile.addOns } };
}

export function previewPlanChange(t: TenantState, account: string, to: PlanConfig): PlanPreview {
  const from = currentConfig(t, account);
  const { day, end } = cycleOf(t);
  const daysLeft = CYCLE_DAYS - day;
  const fromMonthly = configMonthly(t, from);
  const toMonthly = configMonthly(t, to);
  const custom = toMonthly == null;
  const fromM = fromMonthly ?? 0;
  const toM = toMonthly ?? 0;
  const annualTotal = toMonthly == null ? null : to.billing === "annual" ? r2(toM * 12) : null;
  const up = toM > fromM + 0.005 || (to.billing === "annual" && from.billing === "monthly" && toM >= fromM * (1 - t.pack.hub.annualDiscountPct / 100) - 0.005);
  const same = !up && Math.abs(toM - fromM) < 0.005 && to.planId === from.planId && JSON.stringify(to.addOns) === JSON.stringify(from.addOns) && to.billing === from.billing;
  const direction = same ? "same" : up ? "up" : "down";
  const effective = direction === "up" ? "now" : "renewal";
  const r = daysLeft / CYCLE_DAYS;
  let proration = 0;
  if (effective === "now") proration = to.billing === "annual" ? r2(annualTotal! - fromM * r) : r2((toM - fromM) * r);
  const grantsNow: Record<string, number> = {};
  if (effective === "now") for (const m of t.pack.meters) grantsNow[m.id] = Math.max(0, Math.round((configAllowance(t, to, m.id) - configAllowance(t, from, m.id)) * r));
  return {
    from,
    to,
    fromMonthly,
    toMonthly,
    annualTotal,
    direction,
    effective,
    effectiveDate: (effective === "now" ? new Date(t.clock) : end).toISOString(),
    prorationUsd: Math.max(0, proration),
    daysLeft,
    grantsNow,
    nextInvoiceUsd: toMonthly == null ? null : to.billing === "annual" ? (effective === "now" ? 0 : annualTotal) : toM,
    undoHours: t.pack.hub.undoHours,
    custom,
  };
}

export function applyPlanChange(s: TenantState, account: string, to: PlanConfig, actor: string) {
  const pv = previewPlanChange(s, account, to);
  return mutateHub(
    s,
    account,
    (ctx, ts): { ok: boolean; note: string } => {
      if (pv.custom) return { ok: false, note: "This plan is priced by the sales team." };
      if (pv.direction === "same") return { ok: false, note: "That's your current plan." };
      const fromPlan = planOf(ctx.pack, pv.from.planId);
      const toPlan = planOf(ctx.pack, to.planId);
      const change: PlanChange = {
        id: `pc_${fnv1a(ts + to.planId).slice(0, 6)}`,
        at: ts,
        from: pv.from.planId,
        to: to.planId,
        billing: to.billing,
        addOns: { ...to.addOns },
        effective: pv.effective,
        chargeId: null,
        amount: pv.prorationUsd,
        entryIds: [],
        undoUntil: addDays(new Date(ts), pv.undoHours / 24).toISOString(),
        undone: false,
        prev: { planId: ctx.hub.planId, nextPlanId: ctx.hub.nextPlanId, billing: ctx.hub.profile.billing, addOns: { ...ctx.hub.profile.addOns } },
      };
      if (pv.effective === "now") {
        const id = `ch_plan_${ctx.hub.charges.length + 1}`;
        const ok = ctx.hub.card.status === "ok" || ctx.hub.backupCard?.status === "ok";
        ctx.hub.charges.push({ id, ts, amount: pv.prorationUsd, description: `${fromPlan.name} → ${toPlan.name}${to.billing === "annual" ? " (annual)" : ""}, prorated`, status: ok ? "paid" : "failed", reason: ok ? undefined : "No valid card on file" });
        if (!ok) return { ok: false, note: "No valid card on file. Update the card in Billing first." };
        change.chargeId = id;
        ctx.hub.planId = to.planId;
        ctx.hub.nextPlanId = null;
        ctx.hub.profile.billing = to.billing;
        ctx.hub.profile.addOns = { ...to.addOns };
        if (!fromPlan.paid && toPlan.paid) ctx.hub.lifecycle.convertedAt = ctx.hub.lifecycle.convertedAt ?? ts;
        const ev = ctx.book.event({ ts, account, type: "plan.upgraded", status: "ok", note: `${fromPlan.name} → ${toPlan.name} · $${pv.prorationUsd.toFixed(2)} prorated` });
        for (const [m, amt] of Object.entries(pv.grantsNow)) {
          if (amt <= 0) continue;
          const e = ctx.book.post({ ts, account, meter: m, kind: "grant", source: "plan", amount: amt, reason: "plan.proration", actor, eventId: ev.id, note: `${toPlan.name} allowance for the ${pv.daysLeft} days left`, expiresAt: cycleOf(s).end.toISOString(), idempotencyKey: `plan:${change.id}:${m}` });
          change.entryIds.push(e.id);
        }
      } else {
        ctx.hub.nextPlanId = to.planId;
        ctx.book.event({ ts, account, type: "plan.change_scheduled", status: "info", note: `${fromPlan.name} → ${toPlan.name} on ${new Date(pv.effectiveDate).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}` });
      }
      ctx.hub.planChange = change;
      auditEntry(ctx.hub, ts, actor, "plan", "Plan", `${fromPlan.name} · ${pv.from.billing}`, `${toPlan.name} · ${to.billing}${pv.effective === "renewal" ? " (at renewal)" : ""}`);
      return { ok: true, note: pv.effective === "now" ? `You're on ${toPlan.name}. ${fmt$(pv.prorationUsd)} charged for the ${pv.daysLeft} days left.` : `${toPlan.name} starts ${new Date(pv.effectiveDate).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}. Nothing changes until then.` };
    },
    actor,
  );
}

export function undoPlanChange(s: TenantState, account: string, actor: string) {
  return mutateHub(
    s,
    account,
    (ctx, ts): { ok: boolean; note: string } => {
      const c = ctx.hub.planChange;
      if (!c || c.undone) return { ok: false, note: "Nothing to undo." };
      if (new Date(ts) > new Date(c.undoUntil)) return { ok: false, note: "The undo window has closed." };
      // Reverse the prorated grants first: if they were already spent, undo can't put things back as they were.
      for (const id of c.entryIds) {
        const e = ctx.book.ledger.find((x) => x.id === id);
        if (!e) continue;
        const lot = lotsOf(ctx.book.ledger, account, e.meter).find((l) => l.id === id);
        if (!lot || lot.remaining + 1e-6 < e.amount) return { ok: false, note: `${r2(e.amount - (lot?.remaining ?? 0))} of the ${e.amount} ${meterOf(ctx.pack, e.meter).label} this change added are already used, so it can't be undone here. Support can still help.` };
      }
      for (const id of c.entryIds) reverseEntry(ctx.book, id, { ts, actor, note: "Plan change undone" });
      const ch = c.chargeId ? ctx.hub.charges.find((x) => x.id === c.chargeId) : null;
      if (ch) {
        ch.status = "refunded";
        ch.reason = "Plan change undone within 24 hours";
      }
      ctx.hub.planId = c.prev.planId;
      ctx.hub.nextPlanId = c.prev.nextPlanId;
      ctx.hub.profile.billing = c.prev.billing;
      ctx.hub.profile.addOns = { ...c.prev.addOns };
      c.undone = true;
      auditEntry(ctx.hub, ts, actor, "plan", "Plan change undone", planOf(ctx.pack, c.to).name, planOf(ctx.pack, c.prev.planId).name);
      ctx.book.event({ ts, account, type: "plan.change_undone", status: "info", note: `Back on ${planOf(ctx.pack, c.prev.planId).name}${ch ? ` · ${fmt$(ch.amount)} refunded` : ""}` });
      return { ok: true, note: `Back on ${planOf(ctx.pack, c.prev.planId).name}${ch ? `. ${fmt$(ch.amount)} refunded.` : "."}` };
    },
    actor,
  );
}

// ---------------------------------------------------------------- pause, cancel, offers

export type CancelReason = "too-expensive" | "ran-out" | "not-using" | "accuracy" | "switching" | "other";

export const CANCEL_REASONS: { id: CancelReason; label: string }[] = [
  { id: "too-expensive", label: "It costs too much for what I use" },
  { id: "ran-out", label: "Credits run out too quickly" },
  { id: "not-using", label: "I'm not using it enough" },
  { id: "accuracy", label: "The data isn't accurate enough" },
  { id: "switching", label: "I'm moving to another tool" },
  { id: "other", label: "Something else" },
];

export type OfferId = "downgrade" | "own-key" | "auto-top-up" | "rollover" | "pause" | "template" | "support-review";

/** Matched, optional save offers per reason. "switching" and "other" get none: just an honest summary. */
export const OFFERS_FOR: Record<CancelReason, OfferId[]> = {
  "too-expensive": ["downgrade", "own-key"],
  "ran-out": ["auto-top-up", "rollover"],
  "not-using": ["pause", "template"],
  accuracy: ["support-review"],
  switching: [],
  other: [],
};

function survey(s: TenantState, account: string, reason: string, offer: string | null, outcome: ExitSurvey["outcome"]): TenantState {
  const e: ExitSurvey = { id: `ex_${s.exitSurveys.length + 1}_${fnv1a(s.clock + reason + s.tick).slice(0, 4)}`, ts: new Date(new Date(s.clock).getTime() + s.tick * 60_000).toISOString(), account, plan: s.hub[account].planId, reason, offer, outcome };
  return { ...s, exitSurveys: [...s.exitSurveys, e] };
}

export function pauseSubscription(s: TenantState, account: string, cycles: number, reason: string | null, actor: string) {
  const r = mutateHub(
    s,
    account,
    (ctx, ts) => {
      const { end } = cycleOf(s);
      const policy = ctx.pack.hub.pausePolicy;
      const until = addDays(end, CYCLE_DAYS * Math.max(0, Math.min(cycles, ctx.pack.hub.pauseMaxCycles) - 1)).toISOString();
      ctx.hub.status = "paused";
      ctx.hub.pause = { at: ts, policy, until };
      auditEntry(ctx.hub, ts, actor, "subscription", "Subscription", "Active", `Paused until ${new Date(until).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}`);
      ctx.book.event({ ts, account, type: "subscription.paused", status: "info", note: `${policy === "keep" ? "Credits keep working" : "Balances frozen"} until ${new Date(until).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}` });
      return until;
    },
    actor,
  );
  return reason ? { ...r, state: survey(r.state, account, reason, "pause", "accepted") } : r;
}

export function resumeSubscription(s: TenantState, account: string, actor: string) {
  return mutateHub(
    s,
    account,
    (ctx, ts) => {
      const was = ctx.hub.status;
      ctx.hub.status = "active";
      ctx.hub.pause = null;
      ctx.hub.cancelReason = null;
      auditEntry(ctx.hub, ts, actor, "subscription", "Subscription", was === "cancelling" ? "Cancelling" : "Paused", "Active");
      ctx.book.event({ ts, account, type: "subscription.resumed", status: "info", note: was === "cancelling" ? "Cancellation withdrawn" : "Back to active" });
      return true;
    },
    actor,
  );
}

export function cancelSubscription(s: TenantState, account: string, reason: CancelReason, offerShown: string | null, actor: string) {
  const r = mutateHub(
    s,
    account,
    (ctx, ts) => {
      ctx.hub.status = "cancelling";
      ctx.hub.cancelReason = CANCEL_REASONS.find((x) => x.id === reason)?.label ?? reason;
      ctx.hub.autoTopUp = { ...ctx.hub.autoTopUp, enabled: false };
      auditEntry(ctx.hub, ts, actor, "subscription", "Subscription", "Active", `Cancels ${cycleOf(s).end.toLocaleDateString("en-GB", { day: "numeric", month: "short" })}`);
      ctx.book.event({ ts, account, type: "subscription.cancel_scheduled", status: "info", note: `${ctx.hub.cancelReason} · ends ${cycleOf(s).end.toLocaleDateString("en-GB", { day: "numeric", month: "short" })}` });
      return true;
    },
    actor,
  );
  return { ...r, state: survey(r.state, account, reason, offerShown, "cancelled") };
}

/** Keep the subscription without taking an offer (closed the flow): recorded so the Workbench sees it. */
export function keepSubscription(s: TenantState, account: string, reason: CancelReason | null): TenantState {
  return reason ? survey(s, account, reason, null, "kept") : s;
}

export function declineOffer(s: TenantState, account: string, reason: CancelReason, offer: OfferId): TenantState {
  return survey(s, account, reason, offer, "declined");
}

export function acceptOffer(s: TenantState, account: string, reason: CancelReason, offer: OfferId, actor: string, bestPlanId: string | null) {
  let state = s;
  let note = "";
  switch (offer) {
    case "downgrade": {
      if (!bestPlanId) return { state: s, note: "No cheaper plan fits your usage." };
      const r = applyPlanChange(s, account, { planId: bestPlanId, billing: s.hub[account].profile.billing, addOns: {} }, actor);
      state = r.state;
      note = r.result.note;
      break;
    }
    case "pause": {
      const r = pauseSubscription(s, account, 1, null, actor);
      state = r.state;
      note = `Paused until ${new Date(r.result).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}. No charge for the pause.`;
      break;
    }
    default: {
      const r = mutateHub(
        s,
        account,
        (ctx, ts) => applyOfferInCtx(ctx, ts, offer, actor),
        actor,
      );
      state = r.state;
      note = r.result;
    }
  }
  return { state: survey(state, account, reason, offer, "accepted"), note };
}

function applyOfferInCtx(ctx: Ctx, ts: string, offer: OfferId, actor: string): string {
  const prim = primaryMeter(ctx.pack);
  switch (offer) {
    case "own-key":
      awardBadge(ctx, ts, "own-key");
      ctx.book.event({ ts, account: ctx.persona.id, type: "byok.enabled", status: "ok", note: "Own API key added for email lookups · Data Credits drop to zero on those columns" });
      return `Own key added. Email lookups now cost Actions only; ${prim.label} drop to zero on them.`;
    case "auto-top-up": {
      const p = packFor(ctx.pack, prim.id, ctx.pack.autoTopUp.amount);
      ctx.hub.autoTopUp = { ...ctx.hub.autoTopUp, enabled: true, meter: prim.id, threshold: ctx.pack.autoTopUp.threshold, units: ctx.pack.autoTopUp.amount, pausedUntil: null };
      ctx.hub.topUpCap = Math.max(ctx.hub.topUpCap, ctx.pack.autoTopUp.monthlySpendLimit);
      ctx.hub.consents[ctx.hub.region] = ctx.hub.consents[ctx.hub.region] ?? { at: ts, maxPerCharge: null };
      auditEntry(ctx.hub, ts, actor, "auto top-up", "Auto top-up (save offer)", "Off", `below ${ctx.pack.autoTopUp.threshold} add ${ctx.pack.autoTopUp.amount}; cap ${fmt$(ctx.hub.topUpCap)}`);
      return `Auto top-up on: below ${ctx.pack.autoTopUp.threshold.toLocaleString("en-US")} ${prim.label}, add ${ctx.pack.autoTopUp.amount.toLocaleString("en-US")}${p ? ` for ${fmt$(p.pack.price * p.count)}` : ""}, never more than ${fmt$(ctx.hub.topUpCap)} a month.`;
    }
    case "rollover": {
      const amt = Math.round(monthlyAllowance(ctx.pack, ctx.hub.planId, prim.id) * 0.2);
      const ev = ctx.book.event({ ts, account: ctx.persona.id, type: "promo.granted", status: "ok", meters: { [prim.id]: amt }, note: "Rollover bonus (save offer)" });
      ctx.book.post({ ts, account: ctx.persona.id, meter: prim.id, kind: "grant", source: "promo", amount: amt, reason: "promo.goodwill", actor, eventId: ev.id, note: "Rollover bonus · 20% of the monthly allowance", expiresAt: addDays(new Date(ts), 60).toISOString(), idempotencyKey: `offer:rollover:${ctx.persona.id}:${cycleOf(ts).start.toISOString().slice(0, 10)}` });
      return `${amt.toLocaleString("en-US")} bonus ${prim.label} added, valid 60 days. Funded from credits that would have expired unused.`;
    }
    case "template":
      notify(ctx.hub, ts, { channel: "email", to: ctx.persona.name, subject: "Your guided template is ready", body: `${ctx.pack.hub.templateTable}. Open it and run the first column on 10 rows; it costs about 5 ${prim.label}.`, action: "Open template" });
      ctx.book.event({ ts, account: ctx.persona.id, type: "template.added", status: "ok", note: ctx.pack.hub.templateTable });
      return "Guided template added to your workspace. We'll walk you through the first column.";
    case "support-review":
      awardBadge(ctx, ts, "bad-record");
      notify(ctx.hub, ts, { channel: "email", to: ctx.persona.name, subject: "Data accuracy review opened", body: "A data specialist will check 20 recent rows within one business day. Credits for records that turn out wrong come back to your balance.", action: null });
      ctx.book.event({ ts, account: ctx.persona.id, type: "support.review", status: "ok", note: "Accuracy review requested from the cancel flow" });
      return "Accuracy review opened. A specialist replies within one business day, and bad records are credited back.";
    default:
      return "";
  }
}

// ---------------------------------------------------------------- billing profile, cards, coupons

export function updateProfile(s: TenantState, account: string, patch: Partial<Pick<HubAccountState["profile"], "company" | "address" | "taxId" | "email">>, actor: string) {
  return mutateHub(
    s,
    account,
    (ctx, ts) => {
      const p = ctx.hub.profile;
      if (patch.address) auditEntry(ctx.hub, ts, actor, "billing", "Billing address", `${p.address.line1}, ${p.address.city}`, `${patch.address.line1}, ${patch.address.city}`);
      if (patch.taxId !== undefined) auditEntry(ctx.hub, ts, actor, "billing", "Tax ID", p.taxId ?? "None", patch.taxId ?? "None");
      if (patch.company) auditEntry(ctx.hub, ts, actor, "billing", "Company name", p.company, patch.company);
      if (patch.email) auditEntry(ctx.hub, ts, actor, "billing", "Invoice e-mail", p.email, patch.email);
      ctx.hub.profile = { ...p, ...patch };
      ctx.book.event({ ts, account, type: "billing.profile_updated", status: "info", note: "Billing details saved" });
      return true;
    },
    actor,
  );
}

export function applyCoupon(s: TenantState, account: string, code: string, actor: string) {
  return mutateHub(
    s,
    account,
    (ctx, ts): { ok: boolean; note: string } => {
      const c = ctx.pack.hub.coupons.find((x) => x.code.toLowerCase() === code.trim().toLowerCase());
      if (!c) return { ok: false, note: `"${code.trim()}" isn't a code ${ctx.pack.company} recognises. Check the spelling, or ask whoever sent it.` };
      if (ctx.hub.profile.coupons.some((x) => x.code === c.code)) return { ok: false, note: `${c.code} is already on your account.` };
      if (!planOf(ctx.pack, ctx.hub.planId).paid) return { ok: false, note: `${c.code} applies to paid plans. It will work once you upgrade.` };
      ctx.hub.profile.coupons.push({ code: c.code, label: c.label, pctOff: c.pctOff, appliedAt: ts, months: c.months });
      auditEntry(ctx.hub, ts, actor, "billing", "Coupon", null, `${c.code} · ${c.label}`);
      ctx.book.event({ ts, account, type: "coupon.applied", status: "ok", note: `${c.code} · ${c.label}` });
      return { ok: true, note: `${c.code} applied: ${c.label}.` };
    },
    actor,
  );
}

export function setBackupCard(s: TenantState, account: string, action: "add" | "remove" | "make-default", actor: string) {
  return mutateHub(
    s,
    account,
    (ctx, ts) => {
      const h = ctx.hub;
      const exp = addDays(new Date(ts), 365 * 3);
      const label = (c: HubAccountState["card"] | null) => (c ? `${c.brand} ending ${c.last4}` : "None");
      if (action === "add") {
        const before = label(h.backupCard);
        h.backupCard = { brand: "Mastercard", last4: h.backupCard?.last4 === "5520" ? "6631" : "5520", expires: `${String(exp.getMonth() + 1).padStart(2, "0")}/${String(exp.getFullYear()).slice(2)}`, status: "ok" };
        auditEntry(h, ts, actor, "billing", "Backup payment method", before, label(h.backupCard));
      } else if (action === "remove") {
        auditEntry(h, ts, actor, "billing", "Backup payment method", label(h.backupCard), "None");
        h.backupCard = null;
      } else if (h.backupCard) {
        const prev = h.card;
        h.card = h.backupCard;
        h.backupCard = prev;
        auditEntry(h, ts, actor, "billing", "Default payment method", label(prev), label(h.card));
      }
      ctx.book.event({ ts, account, type: "payment_method.updated", status: "ok", note: `Default ${label(h.card)} · backup ${label(h.backupCard)}` });
      return true;
    },
    actor,
  );
}

/** One-tap card update from a banner: new card on file, then the unpaid renewal is retried at once. */
export function replaceCardAndRetry(s: TenantState, account: string, actor: string) {
  const r = mutateHub(
    s,
    account,
    (ctx, ts) => {
      const exp = addDays(new Date(ts), 365 * 3);
      const before = `${ctx.hub.card.brand} ending ${ctx.hub.card.last4}`;
      ctx.hub.card = { ...ctx.hub.card, last4: ctx.hub.card.last4 === "4471" ? "8802" : "4471", expires: `${String(exp.getMonth() + 1).padStart(2, "0")}/${String(exp.getFullYear()).slice(2)}`, status: "ok" };
      ctx.hub.autoTopUpHalted = false;
      auditEntry(ctx.hub, ts, actor, "billing", "Card on file", before, `${ctx.hub.card.brand} ending ${ctx.hub.card.last4}`);
      ctx.book.event({ ts, account, type: "payment_method.updated", status: "ok", note: `${ctx.hub.card.brand} ending ${ctx.hub.card.last4} on file` });
      return true;
    },
    actor,
  );
  const d = r.state.hub[account].dunning.status;
  if (d === "grace" || d === "suspended") return retryRenewal(r.state, account);
  return { state: r.state, result: true };
}

// ---------------------------------------------------------------- rewards, lifecycle, shares

export function verifyDomain(s: TenantState, account: string, actor: string) {
  return mutateHub(
    s,
    account,
    (ctx, ts) => {
      ctx.hub.rewardState.domainVerified = true;
      auditEntry(ctx.hub, ts, actor, "rewards", "Reward wallet domain", "Unverified", ctx.hub.profile.email.split("@")[1] ?? "verified");
      ctx.book.event({ ts, account, type: "rewards.domain_verified", status: "ok", note: `${ctx.hub.profile.email.split("@")[1]} verified · one reward wallet per domain` });
      return true;
    },
    actor,
  );
}

export function earnBadge(s: TenantState, account: string, badgeId: string, actor: string) {
  return mutateHub(s, account, (ctx, ts) => awardBadge(ctx, ts, badgeId), actor);
}

export function recordNudge(s: TenantState, account: string, kind: string) {
  return mutateHub(
    s,
    account,
    (ctx, ts) => {
      const max = ctx.pack.hub.nudges.maxNeverActivated;
      if (ctx.hub.lifecycle.optOut) return "opted-out" as const;
      if (kind.startsWith("activation") && ctx.hub.lifecycle.nudges.filter((n) => n.kind.startsWith("activation")).length >= max) return "capped" as const;
      ctx.hub.lifecycle.nudges.push({ at: ts, kind });
      ctx.book.event({ ts, account, type: "lifecycle.nudge", status: "info", note: kind });
      return "sent" as const;
    },
    "system:lifecycle",
  );
}

export function setOptOut(s: TenantState, account: string, optOut: boolean, actor: string) {
  return mutateHub(
    s,
    account,
    (ctx, ts) => {
      ctx.hub.lifecycle.optOut = optOut;
      auditEntry(ctx.hub, ts, actor, "alerts", "Product e-mails", optOut ? "On" : "Off", optOut ? "Off" : "On");
      return true;
    },
    actor,
  );
}

export function createShare(s: TenantState, account: string, days: number, by: string) {
  return mutateHub(
    s,
    account,
    (ctx, ts) => {
      const id = fnv1a(`${account}:${ts}:${ctx.hub.shares.length}`) + fnv1a(`${ts}:${days}`).slice(0, 4);
      ctx.hub.shares.push({ id, ts, days, by, expiresAt: addDays(new Date(ts), 14).toISOString(), revoked: false });
      ctx.book.event({ ts, account, type: "share.created", status: "info", note: `Read-only usage link (${days} days), expires in 14 days` });
      return id;
    },
    by,
  );
}

export function revokeShare(s: TenantState, account: string, id: string, actor: string) {
  return mutateHub(
    s,
    account,
    (ctx, ts) => {
      const l = ctx.hub.shares.find((x) => x.id === id);
      if (!l) return false;
      l.revoked = true;
      ctx.book.event({ ts, account, type: "share.revoked", status: "info", note: "Read-only usage link revoked" });
      return true;
    },
    actor,
  );
}

export const auditAreas: AuditEntry["area"][] = ["limits", "roles", "auto top-up", "plan", "billing", "requests", "alerts", "rewards", "subscription"];
