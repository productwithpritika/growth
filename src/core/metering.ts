// Metering: runs a workflow against the meters, posts debits, alerts and auto top-ups.
import type { TenantPack, Workflow } from "@/tenants/schema";
import type { Charge, HubAccountState, TenantState, UsageEvent } from "@/core/types";
import { Book, consumption } from "@/core/ledger";
import type { BlockReason } from "@/core/block";
import { limitedByOf } from "@/core/block";
import { addDays, fnv1a, r2 } from "@/core/time";
import { limitsFor, memberIdOfOwner } from "@/core/team";
import { afterQualifyingUsage } from "@/core/rewards-program";
import { meterOf, monthlyAllowance, packFor, planOf, primaryMeter, rateOf, topUpAllowed, type HubPersona } from "@/core/pack";

export interface Ctx {
  pack: TenantPack;
  persona: HubPersona;
  hub: HubAccountState;
  book: Book;
  rng: () => number;
  cycleStart: Date;
  /** Who is acting: "user:maya" for a run started in the Hub, "system:scheduler" for a scheduled one. */
  actor: string;
}

export interface RunResult {
  status: "ok" | "stopped" | "blocked";
  requested: number;
  done: number;
  limitedBy: string | null; // meter id, or "budget" | "mcp" | "paused" | "tier-cap"
  /** Why it stopped or was blocked, typed so a MomentCard can render it. */
  reason: BlockReason | null;
}

/** Credits a hold reserved for this run, drawn before the balance. */
export interface HoldFunding {
  holdId: string;
  reserved: Record<string, number>;
}

const since = (ctx: Ctx, ts: string) => new Date(ts).getTime() >= ctx.cycleStart.getTime();

function cycleBase(ctx: Ctx, meter: string): number {
  return monthlyAllowance(ctx.pack, ctx.hub.planId, meter) + (ctx.persona.carryIn[meter] ?? 0);
}

function debitsThisCycle(ctx: Ctx, meter: string): number {
  let used = 0;
  for (const e of ctx.book.ledger) if (e.account === ctx.persona.id && e.meter === meter && since(ctx, e.ts)) used += consumption(e);
  return used;
}

export function topUpSpend(hub: HubAccountState, cycleStart: Date): number {
  return hub.charges.filter((c) => c.status !== "failed" && c.status !== "refunded" && c.meter && new Date(c.ts).getTime() >= cycleStart.getTime()).reduce((s, c) => s + c.amount, 0);
}

function checkAlerts(ctx: Ctx, ts: string) {
  for (const m of ctx.pack.meters) {
    const base = cycleBase(ctx, m.id);
    if (base <= 0) continue;
    const used = debitsThisCycle(ctx, m.id);
    for (const pct of ctx.pack.rules.alertPcts) {
      const key = `${m.id}:${pct}`;
      if (!ctx.hub.alerts[String(pct)] || ctx.hub.alertsSent.includes(key)) continue;
      if (used / base >= pct / 100) {
        ctx.hub.alertsSent.push(key);
        ctx.book.event({ ts, account: ctx.persona.id, type: "alert.sent", status: "info", note: `${pct}% of ${m.label} used` });
      }
    }
  }
}

export function attemptTopUp(ctx: Ctx, ts: string, meterId: string, units: number, auto: boolean): Charge | null {
  const m = meterOf(ctx.pack, meterId);
  const choice = packFor(ctx.pack, meterId, units);
  if (!choice) return null;
  const credited = choice.pack.units * choice.count;
  const amount = r2(choice.pack.price * choice.count);
  const label = m.valueType === "currency" ? `$${credited.toLocaleString("en-US")} added to balance` : `${credited.toLocaleString("en-US")} ${m.label}`;
  const charge: Charge = { id: `ch_${ctx.book.events.length + 1}_${ctx.book.ledger.length}`, ts, amount, description: `${label}${auto ? " · auto top-up" : ""}`, status: "paid", meter: m.id, units: credited };
  let paidWith = `${ctx.hub.card.brand} ending ${ctx.hub.card.last4}`;
  if (ctx.hub.card.status !== "ok") {
    const declined = `${ctx.hub.card.brand} ending ${ctx.hub.card.last4} expired`;
    const backup = ctx.hub.backupCard;
    // Failure handling (auto top-up setting): fall back to the backup method when there is a valid one.
    if (backup && backup.status === "ok" && (!auto || ctx.hub.autoTopUp.onFail === "backup")) {
      ctx.book.event({ ts, account: ctx.persona.id, type: "payment.fallback", status: "info", note: `${declined} · charged backup ${backup.brand} ending ${backup.last4}` });
      paidWith = `backup ${backup.brand} ending ${backup.last4}`;
      charge.reason = `${declined}; paid with backup ${backup.brand} ending ${backup.last4}`;
    } else {
      charge.status = "failed";
      charge.reason = declined;
      ctx.hub.charges.push(charge);
      const retry = auto && ctx.hub.autoTopUp.onFail === "retry";
      ctx.book.event({ ts, account: ctx.persona.id, type: "topup.failed", status: "failed", meters: { [m.id]: credited }, note: `$${amount.toFixed(2)} declined · ${declined}${retry ? " · retrying tomorrow" : ""}` });
      if (auto) ctx.hub.autoTopUpHalted = true;
      return charge;
    }
  }
  ctx.hub.charges.push(charge);
  const ev = ctx.book.event({ ts, account: ctx.persona.id, type: "topup.purchased", status: "ok", meters: { [m.id]: credited }, note: `$${amount.toFixed(2)} charged to ${paidWith}` });
  const expiresAt = choice.pack.validityDays ? addDays(new Date(ts), choice.pack.validityDays).toISOString() : null;
  ctx.book.post({
    ts,
    account: ctx.persona.id,
    meter: m.id,
    kind: "grant",
    source: "topup",
    amount: credited,
    reason: auto ? "topup.auto" : "topup.purchase",
    actor: auto ? "system:auto-top-up" : ctx.actor,
    eventId: ev.id,
    note: charge.description,
    expiresAt,
    idempotencyKey: `topup:${charge.id}`,
  });
  return charge;
}

export function maybeAutoTopUp(ctx: Ctx, ts: string) {
  const at = ctx.hub.autoTopUp;
  if (!at.enabled || ctx.hub.autoTopUpHalted) return;
  if (at.pausedUntil && new Date(at.pausedUntil).getTime() > new Date(ts).getTime()) return;
  if (ctx.book.balance(ctx.persona.id, at.meter) >= at.threshold) return;
  if (!topUpAllowed(ctx.pack, at.meter, planOf(ctx.pack, ctx.hub.planId), "cockpit")) return;
  if (!ctx.hub.consents?.[ctx.hub.region]) {
    ctx.hub.autoTopUpHalted = true;
    ctx.book.event({ ts, account: ctx.persona.id, type: "topup.skipped", status: "info", note: "Automatic charges need consent for this billing region" });
    return;
  }
  const choice = packFor(ctx.pack, at.meter, at.units);
  if (!choice) return;
  const price = choice.pack.price * choice.count;
  if (topUpSpend(ctx.hub, ctx.cycleStart) + price > ctx.hub.topUpCap + 0.001) {
    ctx.hub.autoTopUpHalted = true;
    if (at.atCap === "ask") ctx.hub.capAsk = { at: ts, usd: r2(price) };
    ctx.book.event({ ts, account: ctx.persona.id, type: "topup.skipped", status: "info", note: `Monthly cap of $${ctx.hub.topUpCap.toLocaleString("en-US")} reached${at.atCap === "ask" ? " · asked an admin to allow one more" : ""}` });
    return;
  }
  attemptTopUp(ctx, ts, at.meter, at.units, true);
}

export function workflowSpend(t: Pick<TenantState, "events" | "clock" | "cycleStart">, account: string, filter: (e: UsageEvent) => boolean, meter: string): number {
  const start = new Date(t.cycleStart).getTime();
  let s = 0;
  for (const e of t.events) if (e.account === account && e.type === "usage" && new Date(e.ts).getTime() >= start && filter(e)) s += e.meters?.[meter] ?? 0;
  return r2(s);
}

export function expectedRunCost(pack: TenantPack, w: Workflow): Record<string, number> {
  const out: Record<string, number> = {};
  const prim = primaryMeter(pack).id;
  for (const stepId of w.steps) {
    const item = rateOf(pack, stepId);
    if (!item) continue;
    for (const [m, c] of Object.entries(item.costs)) out[m] = r2((out[m] ?? 0) + w.units * c * (item.chargeOnHit && m === prim ? item.hitRate : 1));
  }
  return out;
}

export function executeRun(ctx: Ctx, w: Workflow, ts: string, hold?: HoldFunding): RunResult {
  const pid = ctx.persona.id;
  const prim = primaryMeter(ctx.pack).id;
  const reserved: Record<string, number> = { ...(hold?.reserved ?? {}) };
  const settle = () => {
    if (!hold) return;
    for (const m of Object.keys(hold.reserved)) {
      const left = r2(reserved[m] ?? 0);
      const used = r2(hold.reserved[m] - left);
      ctx.book.post({ ts, account: pid, meter: m, kind: "release", amount: Math.max(0, left), reason: "hold.settled", actor: ctx.actor, eventId: null, note: `${w.name} finished · ${used} used of ${hold.reserved[m]} held, ${Math.max(0, left)} released`, holdId: hold.holdId, idempotencyKey: `hold:${hold.holdId}:${m}:settle` });
    }
  };
  const blocked = (reason: BlockReason, note: string): RunResult => {
    const limitedBy = limitedByOf(reason);
    ctx.book.event({ ts, account: pid, type: "run.blocked", workflow: w.name, channel: w.channel, units: w.units, done: 0, status: "blocked", limitedBy, reason, member: memberIdOfOwner(w.owner), note });
    settle();
    return { status: "blocked", requested: w.units, done: 0, limitedBy, reason };
  };
  const spentBy = (f: (e: UsageEvent) => boolean) => workflowSpend({ events: ctx.book.events, clock: ts, cycleStart: ctx.cycleStart.toISOString() }, pid, f, prim);
  // Pause policy (Tenant Pack hub.pausePolicy): "keep" lets credits already on the account keep working; "freeze" stops runs.
  if (ctx.hub.status === "paused" && ctx.pack.hub.pausePolicy === "freeze") return blocked({ code: "subscription_paused" }, "Subscription is paused");
  if (ctx.hub.dunning?.status === "suspended") return blocked({ code: "payment_overdue", graceEnded: ctx.hub.dunning.graceUntil ?? ts, amount: ctx.hub.dunning.amount }, "Renewal unpaid after the grace window");
  const member = memberIdOfOwner(w.owner);
  const over = ctx.hub.limits?.length ? limitsFor(ctx.hub, ctx.book.events, pid, ctx.cycleStart, { member, tableId: w.id, table: w.name }).find((x) => x.state === "block") : undefined;
  if (over) return blocked({ code: "spend_limit", scope: over.limit.scope, target: over.limit.scope === "member" ? (ctx.hub.team.find((m) => m.id === member)?.name ?? member) : over.limit.scope === "table" ? w.name : "workspace", meter: over.limit.meter, limit: over.limit.amount, spent: over.spent }, "Spend limit reached");
  const budget = ctx.hub.budgets[w.id];
  if (budget != null) {
    const spent = spentBy((e) => e.workflow === w.name);
    if (spent >= budget) return blocked({ code: "budget_reached", workflow: w.name, budget, spent: r2(spent) }, "Workflow budget reached");
  }
  if (w.channel === "MCP" && ctx.hub.mcpCap != null) {
    const spent = spentBy((e) => e.channel === "MCP");
    if (spent >= ctx.hub.mcpCap) return blocked({ code: "channel_cap", channel: "MCP", cap: ctx.hub.mcpCap, spent: r2(spent) }, "MCP spending cap reached");
  }
  const plan = planOf(ctx.pack, ctx.hub.planId);
  const tierCap = plan.caps.monthlySpend;
  if (ctx.pack.limits.spend.tierCaps && tierCap != null && meterOf(ctx.pack, prim).valueType === "currency") {
    const spent = debitsThisCycle(ctx, prim);
    if (spent >= tierCap) return blocked({ code: "tier_cap", plan: plan.name, cap: tierCap, spent: r2(spent) }, `${plan.name} monthly spend cap reached`);
  }
  const spendable = (m: string) => ctx.book.spendable(pid, m) + (reserved[m] ?? 0);
  let rows = w.units;
  let limitedBy: string | null = null;
  let reason: BlockReason | null = null;
  let ranAny = false;
  for (const stepId of w.steps) {
    const item = rateOf(ctx.pack, stepId);
    if (!item) continue;
    if (item.requires && !plan.features.includes(item.requires)) {
      ctx.book.event({ ts, account: pid, type: "usage", workflow: w.name, step: item.label, channel: w.channel, units: rows, done: 0, meters: {}, member, status: "stopped", reason: { code: "plan_feature", feature: item.requires, step: item.label }, note: `Skipped · needs a plan with ${item.requires.toUpperCase()}` });
      continue;
    }
    let cap = rows;
    let limiter: string | null = null;
    for (const m of ctx.pack.meters) {
      const per = (item.costs[m.id] ?? 0) * (item.chargeOnHit && m.id === prim ? item.hitRate : 1);
      if (per <= 0) continue;
      const fit = Math.floor(spendable(m.id) / per + 1e-9);
      if (fit < cap) {
        cap = Math.max(0, fit);
        limiter = m.id;
      }
    }
    const done = cap;
    const shortOf = (m: string): BlockReason => {
      const per = (item.costs[m] ?? 0) * (item.chargeOnHit && m === prim ? item.hitRate : 1);
      return { code: "insufficient_balance", meter: m, needed: r2(per * rows), available: r2(spendable(m)) };
    };
    if (done === 0) {
      limitedBy = limiter;
      reason = shortOf(limiter ?? prim);
      const label = meterOf(ctx.pack, limiter ?? prim).label;
      if (!ranAny) return blocked(reason, `Out of ${label}`);
      ctx.book.event({ ts, account: pid, type: "usage", workflow: w.name, step: item.label, channel: w.channel, units: rows, done: 0, meters: {}, member, status: "stopped", limitedBy: limiter ?? undefined, reason, note: `Out of ${label}` });
      rows = 0;
      break;
    }
    const jitter = (ctx.rng() - 0.5) * Math.sqrt(done);
    const hits = item.chargeOnHit ? Math.min(done, Math.max(0, Math.round(done * item.hitRate + jitter))) : done;
    const meters: Record<string, number> = {};
    for (const m of ctx.pack.meters) {
      const c = item.costs[m.id] ?? 0;
      if (c <= 0) continue;
      meters[m.id] = Math.min(r2((item.chargeOnHit && m.id === prim ? hits : done) * c), r2(spendable(m.id)));
    }
    const stopped = done < rows;
    const stopReason = stopped ? shortOf(limiter ?? prim) : null;
    const retries = Math.round(done * (parseInt(fnv1a(`${w.id}:${ts}:${stepId}`).slice(0, 4), 16) / 65535) * 0.05);
    const ev = ctx.book.event({
      ts,
      account: pid,
      type: "usage",
      workflow: w.name,
      step: item.label,
      channel: w.channel,
      units: rows,
      done,
      meters,
      member,
      found: hits,
      verified: item.verifiedShare != null ? Math.round(hits * item.verifiedShare) : undefined,
      retries,
      status: stopped ? "stopped" : "ok",
      limitedBy: stopped ? (limiter ?? undefined) : undefined,
      reason: stopReason ?? undefined,
      note: item.chargeOnHit ? `${hits} of ${done} found` : `${done.toLocaleString("en-US")} ${ctx.pack.workUnit.many}`,
    });
    for (const [mid, amt] of Object.entries(meters)) {
      // Draw from the hold first; only what the hold doesn't cover is debited.
      const fromHold = Math.min(amt, reserved[mid] ?? 0);
      if (fromHold > 0) reserved[mid] = r2((reserved[mid] ?? 0) - fromHold);
      const rest = r2(amt - fromHold);
      if (rest > 0) ctx.book.post({ ts, account: pid, meter: mid, kind: "debit", amount: -rest, reason: hold ? "usage.over-hold" : "usage.run", actor: ctx.actor, eventId: ev.id, note: `${w.name} · ${item.label}`, holdId: hold?.holdId ?? null });
    }
    ranAny = true;
    if (item.verifiedShare != null && ctx.hub.rewardState) afterQualifyingUsage(ctx, ts, done, ev.verified ?? 0);
    checkAlerts(ctx, ts);
    maybeAutoTopUp(ctx, ts);
    rows = done;
    if (stopped) {
      limitedBy = limiter;
      reason = stopReason;
      break;
    }
  }
  settle();
  return { status: limitedBy ? "stopped" : "ok", requested: w.units, done: rows, limitedBy, reason };
}

export interface Driver {
  workflow: string;
  channel: string;
  steps: { step: string; units: number; done: number; meters: Record<string, number> }[];
  meters: Record<string, number>;
}

export function usageDrivers(t: TenantState, account: string): Driver[] {
  const start = new Date(t.cycleStart).getTime();
  const map = new Map<string, Driver>();
  for (const e of t.events) {
    if (e.account !== account || e.type !== "usage" || !e.workflow || new Date(e.ts).getTime() < start) continue;
    const d = map.get(e.workflow) ?? { workflow: e.workflow, channel: e.channel ?? "Table", steps: [], meters: {} };
    let st = d.steps.find((x) => x.step === e.step);
    if (!st) {
      st = { step: e.step ?? "", units: 0, done: 0, meters: {} };
      d.steps.push(st);
    }
    st.units += e.units ?? 0;
    st.done += e.done ?? 0;
    for (const [m, v] of Object.entries(e.meters ?? {})) {
      st.meters[m] = r2((st.meters[m] ?? 0) + v);
      d.meters[m] = r2((d.meters[m] ?? 0) + v);
    }
    map.set(e.workflow, d);
  }
  return [...map.values()];
}

