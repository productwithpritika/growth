// Tables and the pre-run cost estimator (Phase 2 §2.3–2.4). Adding an enrichment column
// estimates the run, confirming places a hold, rows are processed in order with live debit,
// and the run pauses cleanly when credits or a blocking limit run out ("nothing lost").
// Every recovery path resumes the same run from the next row.
import type { RateItem, TenantPack } from "@/tenants/schema";
import type { HubAccountState, TableRun, TenantState } from "@/core/types";
import type { BlockReason } from "@/core/block";
import { mutateHub } from "@/core/actions";
import { maybeAutoTopUp, type Ctx } from "@/core/metering";
import { placeHold } from "@/core/ledger";
import { cycleOf, fnv1a, r2 } from "@/core/time";
import { meterOf, packFor, planOf, primaryMeter, rateOf } from "@/core/pack";
import { limitsFor, memberIdOfOwner, memberName } from "@/core/team";
import { afterQualifyingUsage } from "@/core/rewards-program";

export interface TableDef {
  id: string;
  name: string;
  rows: number;
  source: string;
  owner: string;
  columns: string[];
  channel: string;
}

/** The persona's tables: the estimator table from the pack, then each workflow as a table. */
export function tablesOf(t: TenantState, account: string): TableDef[] {
  const pack = t.pack;
  const demo = pack.demo.hub[account as "maya" | "dev"];
  const hub = t.hub[account];
  const out: TableDef[] = [];
  // Own-key runs fill the same column as the item they replace.
  const base = (stepId: string) => pack.rateCard.find((r) => r.id === stepId)?.byokFor ?? stepId;
  const added = (id: string) => [...new Set(hub.runs.filter((r) => r.tableId === id && r.status !== "stopped").map((r) => base(r.stepId)))];
  if (demo.table) out.push({ id: "estimator", name: demo.table.name, rows: demo.table.rows, source: demo.table.source, owner: account, columns: added("estimator"), channel: "Table" });
  for (const w of demo.workflows) {
    if (w.channel !== "Table") continue;
    if (demo.table && w.name === demo.table.name) {
      out[0] = { ...out[0], id: w.id, owner: memberIdOfOwner(w.owner), columns: [...new Set([...w.steps, ...added(w.id), ...added("estimator")])] };
      continue;
    }
    out.push({ id: w.id, name: w.name, rows: w.units, source: "Scheduled", owner: memberIdOfOwner(w.owner), columns: [...new Set([...w.steps, ...added(w.id)])], channel: w.channel });
  }
  return out;
}

/** Enrichment columns a user can add: everything but own-key variants (offered as an option) and plan-gated items stay listed with their gate. */
export function addableColumns(pack: TenantPack): RateItem[] {
  return pack.rateCard.filter((r) => !r.byok);
}

export function byokVariant(pack: TenantPack, stepId: string): RateItem | null {
  return pack.rateCard.find((r) => r.byok && r.byokFor === stepId) ?? null;
}

/** Credits per row when the row is found (hit) and when it isn't (miss): misses are free on charge-on-hit items. */
export function rowCosts(pack: TenantPack, item: RateItem): Record<string, { hit: number; miss: number }> {
  const prim = primaryMeter(pack).id;
  const out: Record<string, { hit: number; miss: number }> = {};
  for (const m of pack.meters) {
    const c = item.costs[m.id] ?? 0;
    out[m.id] = { hit: c, miss: item.chargeOnHit && m.id === prim ? 0 : c };
  }
  return out;
}

export interface EstimateMeter {
  meter: string;
  hit: number;
  miss: number;
  low: number;
  expected: number;
  high: number;
  hold: number;
  balance: number;
  after: number;
}

export interface Estimate {
  item: RateItem;
  rows: number;
  hitRate: number;
  notFoundShare: number;
  expectedFound: number;
  expectedVerified: number;
  meters: EstimateMeter[];
  usd: { low: number; expected: number; high: number };
  /** Rows the current balance covers at the expected mix. */
  fitsRows: number;
  limitedBy: string | null;
  rowCap: number | null;
  feature: string | null;
  warnings: string[];
  blocks: BlockReason[];
}

/** List value of credits, for "about $x". */
export function usdValue(pack: TenantPack, meters: Record<string, number>): number {
  return r2(pack.meters.reduce((s, m) => s + (meters[m.id] ?? 0) * m.pricePerUnit, 0));
}

export function estimateColumn(t: TenantState, account: string, member: string, table: Pick<TableDef, "id" | "name">, stepId: string, rows: number): Estimate {
  const pack = t.pack;
  const hub = t.hub[account];
  const item = rateOf(pack, stepId) ?? pack.rateCard[0];
  const plan = planOf(pack, hub.planId);
  const costs = rowCosts(pack, item);
  const p = item.chargeOnHit ? item.hitRate : 1;
  const sd = Math.sqrt((p * (1 - p)) / Math.max(1, rows));
  const margin = item.chargeOnHit ? Math.min(0.2, 0.04 + 1.645 * sd) : 0;
  const lowP = Math.max(0, p - margin);
  const highP = Math.min(1, p + margin);
  const balanceOf = (m: string) => {
    const e = [...t.ledger].reverse().find((x) => x.account === account && x.meter === m);
    return Math.max(0, e?.balance ?? 0);
  };
  const meters: EstimateMeter[] = pack.meters.map((m) => {
    const c = costs[m.id];
    const at = (q: number) => r2(rows * (q * c.hit + (1 - q) * c.miss));
    const expected = at(p);
    const high = at(highP);
    const balance = balanceOf(m.id);
    return { meter: m.id, hit: c.hit, miss: c.miss, low: at(lowP), expected, high, hold: r2(Math.min(Math.ceil(high), balance)), balance, after: r2(balance - expected) };
  });
  const per = (m: EstimateMeter) => (p * m.hit + (1 - p) * m.miss);
  let fitsRows = rows;
  let limitedBy: string | null = null;
  for (const m of meters) {
    const pr = per(m);
    if (pr <= 0) continue;
    const fit = Math.floor(m.balance / pr + 1e-9);
    if (fit < fitsRows) {
      fitsRows = Math.max(0, fit);
      limitedBy = m.meter;
    }
  }
  const pending: Record<string, number> = {};
  for (const m of meters) pending[m.meter] = m.expected;
  const who = { member, tableId: table.id, table: table.name };
  const now = limitsFor(hub, t.events, account, cycleOf(t).start, who);
  const after = limitsFor(hub, t.events, account, cycleOf(t).start, who, pending);
  const label = (l: (typeof now)[number]) => (l.limit.scope === "workspace" ? "The workspace" : l.limit.scope === "member" ? `${memberName(hub, member)}'s` : `${table.name}'s`);
  const fmtN = (n: number) => Math.round(n).toLocaleString("en-US");
  const warnings: string[] = [];
  for (const l of after) {
    const before = now.find((x) => x.limit.id === l.limit.id);
    if (!before || before.state === "block" || l.pct < 0.8) continue;
    const m = meterOf(pack, l.limit.meter);
    const perRow = (meters.find((x) => x.meter === l.limit.meter)?.expected ?? 0) / Math.max(1, rows);
    const room = Math.max(0, l.limit.amount - before.spent);
    if (l.limit.behaviour === "block" && l.pct >= 1) warnings.push(`${label(l)} ${fmtN(l.limit.amount)} ${m.label} limit has ${fmtN(room)} left, so this run pauses at about row ${fmtN(perRow > 0 ? room / perRow : rows)} unless an admin raises it. Nothing past the limit is charged.`);
    else warnings.push(`${label(l)} ${m.label} limit: this run brings it to ${fmtN(l.spent)} of ${fmtN(l.limit.amount)}${l.limit.behaviour === "warn" ? ". It's set to warn, so the run continues and the admins get an alert." : "."}`);
  }
  const blocks: BlockReason[] = [];
  for (const l of now) {
    if (l.state !== "block") continue;
    blocks.push({ code: "spend_limit", scope: l.limit.scope, target: l.limit.scope === "member" ? memberName(hub, member) : l.limit.scope === "table" ? table.name : "workspace", meter: l.limit.meter, limit: l.limit.amount, spent: l.spent });
  }
  if (hub.dunning.status === "suspended") blocks.push({ code: "payment_overdue", graceEnded: hub.dunning.graceUntil ?? t.clock, amount: hub.dunning.amount });
  if (hub.status === "paused" && t.pack.hub.pausePolicy === "freeze") blocks.push({ code: "subscription_paused" });
  const found = Math.round(rows * p);
  return {
    item,
    rows,
    hitRate: p,
    notFoundShare: r2(1 - p),
    expectedFound: found,
    expectedVerified: item.verifiedShare != null ? Math.round(found * item.verifiedShare) : 0,
    meters,
    usd: { low: usdValue(pack, Object.fromEntries(meters.map((m) => [m.meter, m.low]))), expected: usdValue(pack, Object.fromEntries(meters.map((m) => [m.meter, m.expected]))), high: usdValue(pack, Object.fromEntries(meters.map((m) => [m.meter, m.high]))) },
    fitsRows,
    limitedBy,
    rowCap: plan.caps.rowsPerTable ?? null,
    feature: item.requires && !plan.features.includes(item.requires) ? item.requires : null,
    warnings,
    blocks,
  };
}

/** Deterministic outcome of one row: found, verified, retried. */
export function rowOutcome(seed: string, row: number, item: RateItem): { found: boolean; verified: boolean; retried: boolean } {
  const h = (k: string) => parseInt(fnv1a(`${seed}:${row}:${k}`), 16) / 0xffffffff;
  const found = !item.chargeOnHit || h("f") < item.hitRate;
  return { found, verified: found && item.verifiedShare != null && h("v") < item.verifiedShare, retried: h("r") < 0.04 };
}

function holdFor(ctx: Ctx, run: TableRun, item: RateItem, ts: string) {
  const remaining = run.rows - run.done;
  const costs = rowCosts(ctx.pack, item);
  const p = item.chargeOnHit ? item.hitRate : 1;
  const margin = item.chargeOnHit ? Math.min(0.2, 0.04 + 1.645 * Math.sqrt((p * (1 - p)) / Math.max(1, remaining))) : 0;
  const q = Math.min(1, p + margin);
  run.holdId = `hold:${run.id}:${run.segments}`;
  run.held = {};
  run.drawn = {};
  for (const m of ctx.pack.meters) {
    const want = Math.ceil(remaining * (q * costs[m.id].hit + (1 - q) * costs[m.id].miss));
    const amt = r2(Math.min(want, ctx.book.spendable(ctx.persona.id, m.id)));
    if (amt <= 0) continue;
    placeHold(ctx.book, { ts, account: ctx.persona.id, meter: m.id, amount: amt, holdId: run.holdId, actor: `user:${run.member}`, eventId: null, note: `${run.table} · ${run.column} · rows ${run.done + 1}–${run.rows}` });
    run.held[m.id] = amt;
    run.drawn[m.id] = 0;
  }
}

function releaseHold(ctx: Ctx, run: TableRun, ts: string) {
  if (!run.holdId) return;
  for (const [m, amt] of Object.entries(run.held)) {
    const left = r2(Math.max(0, amt - (run.drawn[m] ?? 0)));
    ctx.book.post({ ts, account: ctx.persona.id, meter: m, kind: "release", amount: left, reason: "hold.settled", actor: `user:${run.member}`, eventId: null, note: `${run.table} · ${run.column} · ${r2(run.drawn[m] ?? 0)} used of ${amt} held, ${left} released`, holdId: run.holdId, idempotencyKey: `${run.holdId}:${m}:settle` });
    run.released[m] = r2((run.released[m] ?? 0) + left);
  }
  run.holdId = null;
  run.held = {};
  run.drawn = {};
}

export interface StartSpec {
  member: string;
  table: Pick<TableDef, "id" | "name">;
  stepId: string;
  rows: number;
  byok: boolean;
}

export function startTableRun(s: TenantState, account: string, spec: StartSpec) {
  return mutateHub(
    s,
    account,
    (ctx, ts): { ok: true; runId: string } | { ok: false; reason: BlockReason | string } => {
      const est = estimateColumn(s, account, spec.member, spec.table, spec.stepId, spec.rows);
      if (est.blocks.length) return { ok: false, reason: est.blocks[0] };
      if (est.feature) return { ok: false, reason: { code: "plan_feature", feature: est.feature, step: est.item.label } };
      if (est.rowCap != null && spec.rows > est.rowCap) return { ok: false, reason: `${planOf(ctx.pack, ctx.hub.planId).name} allows ${est.rowCap} rows per table` };
      const item = rateOf(ctx.pack, spec.stepId)!;
      const id = `run_${ctx.hub.runs.length + 1}_${fnv1a(ts + spec.stepId).slice(0, 4)}`;
      const run: TableRun = {
        id,
        tableId: spec.table.id,
        table: spec.table.name,
        stepId: item.id,
        column: item.label,
        byok: item.byok,
        rows: spec.rows,
        done: 0,
        found: 0,
        verified: 0,
        notFound: 0,
        retries: 0,
        status: "running",
        holdId: null,
        held: {},
        drawn: {},
        used: {},
        released: {},
        member: spec.member,
        startedAt: ts,
        updatedAt: ts,
        pausedReason: null,
        resumeAt: null,
        segments: 1,
        warnings: est.warnings,
      };
      ctx.book.event({ ts, account, type: "run.started", workflow: run.table, step: run.column, channel: "Table", units: run.rows, member: run.member, runId: id, status: "info", note: `Estimate ${est.meters.map((m) => `${m.expected} ${meterOf(ctx.pack, m.meter).label}`).join(" + ")}` });
      holdFor(ctx, run, item, ts);
      ctx.hub.runs.push(run);
      return { ok: true, runId: id };
    },
    `user:${spec.member}`,
  );
}

function pauseRun(ctx: Ctx, run: TableRun, ts: string, reason: BlockReason) {
  releaseHold(ctx, run, ts);
  run.status = "paused";
  run.pausedReason = reason;
  ctx.book.event({ ts, account: ctx.persona.id, type: "run.paused", workflow: run.table, step: run.column, channel: "Table", units: run.rows, done: run.done, member: run.member, runId: run.id, reason, status: "stopped", note: `Paused at row ${run.done.toLocaleString("en-US")} of ${run.rows.toLocaleString("en-US")} · nothing lost` });
}

/** Process up to `maxRows` more rows. Returns the run's status afterwards. */
export function advanceTableRun(s: TenantState, account: string, runId: string, maxRows: number) {
  return mutateHub(s, account, (ctx, ts) => advanceInCtx(ctx, ts, runId, maxRows), `system:table-run`);
}

export function advanceInCtx(ctx: Ctx, ts: string, runId: string, maxRows: number): TableRun["status"] | "missing" {
  const run = ctx.hub.runs.find((r) => r.id === runId);
  if (!run) return "missing";
  if (run.status !== "running") return run.status;
  const item = rateOf(ctx.pack, run.stepId)!;
  const costs = rowCosts(ctx.pack, item);
  const pid = ctx.persona.id;
  const chunk: Record<string, number> = {};
  const overHold: Record<string, number> = {};
  let found = 0;
  let verified = 0;
  let retries = 0;
  let processed = 0;
  const end = Math.min(run.rows, run.done + Math.max(1, maxRows));
  const blockOf = (): BlockReason | null => {
    if (ctx.hub.dunning.status === "suspended") return { code: "payment_overdue", graceEnded: ctx.hub.dunning.graceUntil ?? ts, amount: ctx.hub.dunning.amount };
    const lim = limitsFor(ctx.hub, ctx.book.events, pid, ctx.cycleStart, { member: run.member, tableId: run.tableId, table: run.table }, chunk).find((l) => l.state === "block");
    if (lim) return { code: "spend_limit", scope: lim.limit.scope, target: lim.limit.scope === "member" ? memberName(ctx.hub, run.member) : lim.limit.scope === "table" ? run.table : "workspace", meter: lim.limit.meter, limit: lim.limit.amount, spent: lim.spent };
    return null;
  };
  let stop: BlockReason | null = blockOf();
  for (let row = run.done; row < end && !stop; row++) {
    const o = rowOutcome(run.id, row, item);
    const need: Record<string, number> = {};
    for (const m of ctx.pack.meters) need[m.id] = o.found ? costs[m.id].hit : costs[m.id].miss;
    // A row runs only if every meter can pay for it: from the hold first, then the balance.
    const short = () => ctx.pack.meters.find((m) => {
      const fromHold = Math.max(0, (run.held[m.id] ?? 0) - (run.drawn[m.id] ?? 0));
      return need[m.id] > fromHold + ctx.book.spendable(pid, m.id) - (overHold[m.id] ?? 0) + 1e-9;
    });
    let gap = short();
    if (gap) {
      flushDebits(ctx, run, ts, overHold);
      maybeAutoTopUp(ctx, ts);
      gap = short();
    }
    if (gap) {
      const fromHold = Math.max(0, (run.held[gap.id] ?? 0) - (run.drawn[gap.id] ?? 0));
      stop = { code: "insufficient_balance", meter: gap.id, needed: r2(need[gap.id] * (run.rows - row)), available: r2(fromHold + ctx.book.spendable(pid, gap.id)) };
      break;
    }
    for (const m of ctx.pack.meters) {
      const n = need[m.id];
      if (n <= 0) continue;
      const fromHold = Math.min(n, Math.max(0, (run.held[m.id] ?? 0) - (run.drawn[m.id] ?? 0)));
      if (fromHold > 0) run.drawn[m.id] = r2((run.drawn[m.id] ?? 0) + fromHold);
      const rest = r2(n - fromHold);
      if (rest > 0) overHold[m.id] = r2((overHold[m.id] ?? 0) + rest);
      chunk[m.id] = r2((chunk[m.id] ?? 0) + n);
    }
    if (o.found) found++;
    if (o.verified) verified++;
    if (o.retried) retries++;
    processed++;
    run.done = row + 1;
  }
  flushDebits(ctx, run, ts, overHold);
  if (processed > 0) {
    ctx.book.event({ ts, account: pid, type: "usage", workflow: run.table, step: run.column, channel: "Table", units: processed, done: processed, meters: chunk, member: run.member, runId: run.id, found, verified: item.verifiedShare != null ? verified : undefined, retries, status: "ok", note: item.chargeOnHit ? `${found} of ${processed} found` : `${processed} ${ctx.pack.workUnit.many}` });
    for (const [m, v] of Object.entries(chunk)) run.used[m] = r2((run.used[m] ?? 0) + v);
    run.found += found;
    run.verified += verified;
    run.notFound += processed - found;
    run.retries += retries;
  }
  run.updatedAt = ts;
  if (stop) {
    pauseRun(ctx, run, ts, stop);
    return run.status;
  }
  if (run.done >= run.rows) {
    releaseHold(ctx, run, ts);
    run.status = "done";
    run.pausedReason = null;
    ctx.book.event({ ts, account: pid, type: "run.finished", workflow: run.table, step: run.column, channel: "Table", units: run.rows, done: run.done, member: run.member, runId: run.id, status: "ok", note: `${run.found} of ${run.rows} found${item.verifiedShare != null ? ` · ${run.verified} verified` : ""}` });
    if (item.verifiedShare != null) afterQualifyingUsage(ctx, ts, run.rows, run.verified);
  }
  return run.status;
}

function flushDebits(ctx: Ctx, run: TableRun, ts: string, overHold: Record<string, number>) {
  for (const [m, v] of Object.entries(overHold)) {
    if (v <= 0) continue;
    ctx.book.post({ ts, account: ctx.persona.id, meter: m, kind: "debit", amount: -r2(v), reason: run.holdId ? "usage.over-hold" : "usage.run", actor: `user:${run.member}`, eventId: null, note: `${run.table} · ${run.column}`, holdId: run.holdId });
    overHold[m] = 0;
  }
}

export type ResumeHow = "continue" | "byok";

/** Resume a paused or waiting run from the next row, optionally on the customer's own key. */
export function resumeTableRun(s: TenantState, account: string, runId: string, how: ResumeHow, actor: string) {
  return mutateHub(
    s,
    account,
    (ctx, ts): { ok: boolean; why?: string } => resumeInCtx(ctx, ts, runId, how),
    actor,
  );
}

export function resumeInCtx(ctx: Ctx, ts: string, runId: string, how: ResumeHow): { ok: boolean; why?: string } {
  const run = ctx.hub.runs.find((r) => r.id === runId);
  if (!run || (run.status !== "paused" && run.status !== "waiting")) return { ok: false, why: "That run isn't paused." };
  if (how === "byok") {
    const v = byokVariant(ctx.pack, run.stepId);
    if (!v) return { ok: false, why: `No own-key option for ${run.column}.` };
    run.stepId = v.id;
    run.column = v.label;
    run.byok = true;
  }
  run.status = "running";
  run.pausedReason = null;
  run.resumeAt = null;
  run.segments += 1;
  holdFor(ctx, run, rateOf(ctx.pack, run.stepId)!, ts);
  ctx.book.event({ ts, account: ctx.persona.id, type: "run.resumed", workflow: run.table, step: run.column, channel: "Table", units: run.rows, done: run.done, member: run.member, runId: run.id, status: "info", note: how === "byok" ? `Resumed at row ${run.done + 1} on your own API key` : `Resumed at row ${run.done + 1}` });
  return { ok: true };
}

/** "Run smaller": keep the rows already enriched and stop here. Nothing else is charged. */
export function stopTableRun(s: TenantState, account: string, runId: string, actor: string) {
  return mutateHub(
    s,
    account,
    (ctx, ts) => {
      const run = ctx.hub.runs.find((r) => r.id === runId);
      if (!run || run.status === "done" || run.status === "stopped") return false;
      releaseHold(ctx, run, ts);
      run.status = "stopped";
      run.resumeAt = null;
      ctx.book.event({ ts, account, type: "run.stopped", workflow: run.table, step: run.column, channel: "Table", units: run.rows, done: run.done, member: run.member, runId: run.id, status: "info", note: `Kept ${run.done.toLocaleString("en-US")} enriched rows; the other ${(run.rows - run.done).toLocaleString("en-US")} were not run or charged` });
      return true;
    },
    actor,
  );
}

/** "Wait for reset": the run resumes on its own when the cycle's credits arrive. */
export function waitForReset(s: TenantState, account: string, runId: string, actor: string) {
  return mutateHub(
    s,
    account,
    (ctx, ts) => {
      const run = ctx.hub.runs.find((r) => r.id === runId);
      if (!run || run.status !== "paused") return false;
      run.status = "waiting";
      run.resumeAt = cycleOf(s).end.toISOString();
      ctx.book.event({ ts, account, type: "run.waiting", workflow: run.table, step: run.column, channel: "Table", units: run.rows, done: run.done, member: run.member, runId: run.id, status: "info", note: `Resumes ${cycleOf(s).end.toLocaleDateString("en-GB", { day: "numeric", month: "short" })} when credits reset` });
      return true;
    },
    actor,
  );
}

/** At renewal: runs waiting for the reset pick up where they stopped and finish what the new credits cover. */
export function resumeWaiting(ctx: Ctx, ts: string) {
  for (const run of ctx.hub.runs) {
    if (run.status !== "waiting" || !run.resumeAt || new Date(run.resumeAt).getTime() > new Date(ts).getTime()) continue;
    resumeInCtx(ctx, ts, run.id, "continue");
    advanceInCtx(ctx, ts, run.id, run.rows);
  }
}

/** One-off starter pack for Free accounts at the limit (Tenant Pack hub.starterPack). */
export function buyStarterPack(s: TenantState, account: string) {
  return mutateHub(s, account, (ctx, ts) => {
    const sp = ctx.pack.hub.starterPack;
    if (!sp) return null;
    const m = primaryMeter(ctx.pack);
    const id = `ch_starter_${ctx.hub.charges.length + 1}`;
    ctx.hub.charges.push({ id, ts, amount: sp.price, description: `Starter pack · ${sp.units.toLocaleString("en-US")} ${m.label}`, status: "paid", meter: m.id, units: sp.units });
    const ev = ctx.book.event({ ts, account, type: "topup.purchased", status: "ok", meters: { [m.id]: sp.units }, note: `Starter pack $${sp.price.toFixed(2)}` });
    ctx.book.post({ ts, account, meter: m.id, kind: "grant", source: "topup", amount: sp.units, reason: "topup.starter", actor: ctx.actor, eventId: ev.id, note: "Starter pack", expiresAt: sp.validityDays ? new Date(new Date(ts).getTime() + sp.validityDays * 86_400_000).toISOString() : null, idempotencyKey: `topup:${id}` });
    return id;
  });
}

/** Price per credit of the smallest pack that covers `need`, for the mid-run options. */
export function cheapestCover(pack: TenantPack, meterId: string, need: number) {
  const c = packFor(pack, meterId, Math.max(1, need));
  if (!c) return null;
  const units = c.pack.units * c.count;
  const price = r2(c.pack.price * c.count);
  return { units, price, perCredit: price / units, validityDays: c.pack.validityDays };
}

/** Live view numbers for a run: drawn from the hold so far and what is still reserved. */
export function runLive(hub: HubAccountState, runId: string) {
  const run = hub.runs.find((r) => r.id === runId);
  if (!run) return null;
  const reserved: Record<string, number> = {};
  for (const [m, v] of Object.entries(run.held)) reserved[m] = r2(Math.max(0, v - (run.drawn[m] ?? 0)));
  return { run, reserved };
}


/** "Run smaller": trim the run to what is already done plus `more` rows, then carry on. Trimmed rows are never run or charged. */
export function shrinkTableRun(s: TenantState, account: string, runId: string, more: number, actor: string) {
  return mutateHub(
    s,
    account,
    (ctx, ts): { ok: boolean; why?: string } => {
      const run = ctx.hub.runs.find((r) => r.id === runId);
      if (!run || run.status !== "paused") return { ok: false, why: "That run isn't paused." };
      const target = Math.min(run.rows, run.done + Math.max(0, Math.floor(more)));
      const dropped = run.rows - target;
      run.rows = target;
      ctx.book.event({ ts, account, type: "run.trimmed", workflow: run.table, step: run.column, channel: "Table", units: target, done: run.done, member: run.member, runId: run.id, status: "info", note: `Run trimmed to ${target.toLocaleString("en-US")} rows; ${dropped.toLocaleString("en-US")} rows left out, nothing charged for them` });
      if (target <= run.done) {
        run.status = "done";
        run.pausedReason = null;
        return { ok: true };
      }
      return resumeInCtx(ctx, ts, runId, "continue");
    },
    actor,
  );
}
