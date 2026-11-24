// The usage explainer's data (Phase 2 §2.2): every run in the last 90 days with its columns,
// providers, models, members, found / not-found / verified rows, retries and holds. The
// current cycle comes from the event stream and the ledger; earlier cycles are replayed from
// the account's workflows with the same rate card, so the breakdown and Plan Fit agree.
import type { TenantPack } from "@/tenants/schema";
import type { TenantState, UsageEvent } from "@/core/types";
import { CYCLE_DAYS, DAY_MS, addDays, cycleOf, fnv1a, mulberry32, r2 } from "@/core/time";
import { isScheduled, monthlyAllowance, personaOf, planOf, primaryMeter, rateOf } from "@/core/pack";
import { memberIdOfOwner, memberName } from "@/core/team";
import { usdValue } from "@/core/table-run";

export interface RunColumn {
  stepId: string;
  label: string;
  provider: string;
  model: string;
  rows: number;
  done: number;
  found: number;
  notFound: number;
  verified: number;
  retries: number;
  meters: Record<string, number>;
  /** What the column would have used had it run every requested row. */
  demand: Record<string, number>;
  contact: boolean;
}

export interface RunRecord {
  id: string;
  ts: string;
  table: string;
  member: string;
  channel: string;
  columns: RunColumn[];
  meters: Record<string, number>;
  demand: Record<string, number>;
  rows: number;
  done: number;
  status: "ok" | "stopped" | "paused" | "running" | "waiting" | "done";
  held: Record<string, number>;
  released: Record<string, number>;
  /** Table runs from the Hub carry their run id. */
  runId: string | null;
}

const add = (a: Record<string, number>, b: Record<string, number> | undefined) => {
  for (const [k, v] of Object.entries(b ?? {})) a[k] = r2((a[k] ?? 0) + v);
};

function modelName(pack: TenantPack, stepId: string): string {
  const item = rateOf(pack, stepId);
  if (!item?.model) return item?.byok ? "Your own key" : "No model";
  return pack.models.find((m) => m.id === item.model)?.name ?? item.model;
}

function columnOf(pack: TenantPack, e: UsageEvent): RunColumn {
  const item = pack.rateCard.find((r) => r.label === e.step) ?? pack.rateCard[0];
  const prim = primaryMeter(pack).id;
  const done = e.done ?? 0;
  const perHit = item.costs[prim] ?? 0;
  const found = e.found ?? (item.chargeOnHit && perHit > 0 ? Math.round((e.meters?.[prim] ?? 0) / perHit) : done);
  const demand: Record<string, number> = {};
  const rows = e.units ?? done;
  for (const m of pack.meters) demand[m.id] = r2(rows * (item.costs[m.id] ?? 0) * (item.chargeOnHit && m.id === prim ? item.hitRate : 1));
  return {
    stepId: item.id,
    label: item.label,
    provider: item.provider ?? pack.company,
    model: modelName(pack, item.id),
    rows,
    done,
    found,
    notFound: Math.max(0, done - found),
    verified: e.verified ?? (item.verifiedShare != null ? Math.round(found * item.verifiedShare) : 0),
    retries: e.retries ?? 0,
    meters: { ...(e.meters ?? {}) },
    demand: e.runId ? { ...(e.meters ?? {}) } : demand,
    contact: item.verifiedShare != null,
  };
}

/** Current-cycle runs from the event stream: workflow runs grouped by time, Hub table runs by run id. */
function liveRuns(t: TenantState, account: string): RunRecord[] {
  const pack = t.pack;
  const hub = t.hub[account];
  const map = new Map<string, RunRecord>();
  for (const e of t.events) {
    if (e.account !== account || e.type !== "usage" || !e.workflow) continue;
    const key = e.runId ?? `${e.workflow}@${e.ts}`;
    let r = map.get(key);
    if (!r) {
      const w = pack.demo.hub[account as "maya" | "dev"]?.workflows.find((x) => x.name === e.workflow);
      r = { id: key, ts: e.ts, table: e.workflow, member: e.member ?? (w ? memberIdOfOwner(w.owner) : account), channel: e.channel ?? "Table", columns: [], meters: {}, demand: {}, rows: 0, done: 0, status: "ok", held: {}, released: {}, runId: e.runId ?? null };
      map.set(key, r);
    }
    const col = columnOf(pack, e);
    const same = r.columns.find((c) => c.stepId === col.stepId);
    if (same && e.runId) {
      same.rows += col.rows;
      same.done += col.done;
      same.found += col.found;
      same.notFound += col.notFound;
      same.verified += col.verified;
      same.retries += col.retries;
      add(same.meters, col.meters);
      add(same.demand, col.demand);
    } else r.columns.push(col);
    add(r.meters, col.meters);
    add(r.demand, col.demand);
    if (e.status === "stopped") r.status = "stopped";
  }
  for (const r of map.values()) {
    r.rows = Math.max(...r.columns.map((c) => c.rows), 0);
    r.done = Math.max(...r.columns.map((c) => c.done), 0);
    if (r.runId) {
      const run = hub.runs.find((x) => x.id === r.runId);
      if (run) {
        r.status = run.status;
        r.rows = run.rows;
        r.released = { ...run.released };
        for (const [m, v] of Object.entries(run.used)) r.held[m] = r2(v + (run.released[m] ?? 0));
      }
    }
  }
  // Holds on scheduled workflow runs: hold:<workflowId>:<date>, settled by a release at the run's time.
  for (const e of t.ledger) {
    if (e.account !== account || e.kind !== "release" || !e.holdId?.startsWith("hold:")) continue;
    const wid = e.holdId.split(":")[1];
    const w = pack.demo.hub[account as "maya" | "dev"]?.workflows.find((x) => x.id === wid);
    const r = w ? map.get(`${w.name}@${e.ts}`) : undefined;
    if (!r) continue;
    const held = t.ledger.find((x) => x.kind === "hold" && x.holdId === e.holdId && x.meter === e.meter);
    if (held) r.held[e.meter] = r2(-held.amount);
    r.released[e.meter] = r2(e.amount);
  }
  return [...map.values()];
}

/** Earlier cycles replayed from the account's workflows: same schedule and rate card, seeded per run. Free accounts stop at their allowance. */
function replayedRuns(t: TenantState, account: string, days: number): RunRecord[] {
  const pack = t.pack;
  const persona = personaOf(pack, account);
  const { start } = cycleOf(t);
  const plan = planOf(pack, t.hub[account].planId);
  const prim = primaryMeter(pack).id;
  const out: RunRecord[] = [];
  const from = addDays(new Date(t.clock), -days);
  const autoRefill = plan.paid && t.hub[account].autoTopUp.enabled;
  for (let c = 1; c <= Math.ceil(days / CYCLE_DAYS) + 1; c++) {
    const cs = addDays(start, -CYCLE_DAYS * c);
    const left: Record<string, number> = {};
    for (const m of pack.meters) left[m.id] = monthlyAllowance(pack, plan.id, m.id) + (persona.carryIn[m.id] ?? 0);
    for (let d = 0; d < CYCLE_DAYS; d++) {
      const day = addDays(cs, d);
      persona.workflows.forEach((w, wi) => {
        if (!isScheduled(w, cs, d)) return;
        const ts = new Date(day.getTime() + (8 + wi * 2) * 3_600_000);
        if (ts < from || ts >= start) return;
        const rng = mulberry32(parseInt(fnv1a(`${account}:${w.id}:${ts.toISOString()}`), 16));
        const rec: RunRecord = { id: `${w.name}@${ts.toISOString()}`, ts: ts.toISOString(), table: w.name, member: memberIdOfOwner(w.owner), channel: w.channel, columns: [], meters: {}, demand: {}, rows: w.units, done: w.units, status: "ok", held: {}, released: {}, runId: null };
        let rows = w.units;
        for (const stepId of w.steps) {
          const item = rateOf(pack, stepId);
          if (!item || (item.requires && !plan.features.includes(item.requires))) continue;
          const p = item.chargeOnHit ? Math.min(1, Math.max(0, item.hitRate + (rng() - 0.5) * 0.08)) : 1;
          const per = (m: string) => (item.costs[m] ?? 0) * (item.chargeOnHit && m === prim ? p : 1);
          let done = rows;
          if (!autoRefill) for (const m of pack.meters) if (per(m.id) > 0) done = Math.min(done, Math.floor(Math.max(0, left[m.id]) / per(m.id)));
          const found = item.chargeOnHit ? Math.round(done * p) : done;
          const meters: Record<string, number> = {};
          const demand: Record<string, number> = {};
          for (const m of pack.meters) {
            const c0 = item.costs[m.id] ?? 0;
            if (c0 <= 0) continue;
            meters[m.id] = r2((item.chargeOnHit && m.id === prim ? found : done) * c0);
            demand[m.id] = r2(rows * per(m.id));
            left[m.id] -= meters[m.id];
          }
          rec.columns.push({ stepId: item.id, label: item.label, provider: item.provider ?? pack.company, model: modelName(pack, item.id), rows, done, found, notFound: done - found, verified: item.verifiedShare != null ? Math.round(found * item.verifiedShare) : 0, retries: Math.round(done * rng() * 0.05), meters, demand, contact: item.verifiedShare != null });
          add(rec.meters, meters);
          add(rec.demand, demand);
          if (done < rows) {
            rec.status = "stopped";
            rec.done = done;
            rows = done;
          }
        }
        if (rec.columns.length) out.push(rec);
      });
    }
  }
  return out;
}

export function runHistory(t: TenantState, account: string, days = 90): RunRecord[] {
  const since = new Date(t.clock).getTime() - days * DAY_MS;
  return [...replayedRuns(t, account, days), ...liveRuns(t, account)].filter((r) => new Date(r.ts).getTime() >= since).sort((a, b) => (a.ts < b.ts ? 1 : -1));
}

export type Dimension = "table" | "column" | "provider" | "model" | "member";

export interface BreakdownRow {
  key: string;
  label: string;
  runs: number;
  rows: number;
  found: number;
  verified: number;
  meters: Record<string, number>;
  usd: number;
}

export function breakdown(pack: TenantPack, hub: TenantState["hub"][string], runs: RunRecord[], dim: Dimension): BreakdownRow[] {
  const map = new Map<string, BreakdownRow & { ids: Set<string> }>();
  for (const r of runs) {
    for (const c of r.columns) {
      const key = dim === "table" ? r.table : dim === "column" ? c.label : dim === "provider" ? c.provider : dim === "model" ? c.model : r.member;
      const label = dim === "member" ? memberName(hub, key) : key;
      const row = map.get(key) ?? { key, label, runs: 0, rows: 0, found: 0, verified: 0, meters: {}, usd: 0, ids: new Set<string>() };
      row.ids.add(r.id);
      row.rows += c.done;
      row.found += c.found;
      row.verified += c.verified;
      add(row.meters, c.meters);
      map.set(key, row);
    }
  }
  return [...map.values()]
    .map(({ ids, ...x }) => ({ ...x, runs: ids.size, usd: usdValue(pack, x.meters) }))
    .sort((a, b) => b.usd - a.usd);
}

export interface VerifiedCost {
  spendUsd: number;
  verified: number;
  found: number;
  perVerified: number | null;
  creditsPerVerified: Record<string, number>;
  benchmark: number | null;
  benchmarkLabel: string | null;
}

/** Spend on contact columns divided by found-and-verified results. */
export function costPerVerified(pack: TenantPack, runs: RunRecord[]): VerifiedCost {
  const meters: Record<string, number> = {};
  let verified = 0;
  let found = 0;
  for (const r of runs)
    for (const c of r.columns) {
      if (!c.contact) continue;
      add(meters, c.meters);
      verified += c.verified;
      found += c.found;
    }
  const spendUsd = usdValue(pack, meters);
  const creditsPerVerified: Record<string, number> = {};
  for (const [m, v] of Object.entries(meters)) creditsPerVerified[m] = verified ? v / verified : 0;
  return { spendUsd, verified, found, perVerified: verified ? spendUsd / verified : null, creditsPerVerified, benchmark: pack.hub.benchmark?.costPerVerified ?? null, benchmarkLabel: pack.hub.benchmark?.label ?? null };
}

/** "Enough for about N verified emails at your usual mix", or rows when the account has no contact columns. */
export function usualMix(pack: TenantPack, runs: RunRecord[], meter: string, balance: number): { n: number; noun: string } | null {
  const vc = costPerVerified(pack, runs);
  const per = vc.creditsPerVerified[meter];
  if (vc.verified >= 10 && per > 0) return { n: Math.floor(balance / per), noun: pack.hub.verifiedNoun.many };
  let used = 0;
  let rows = 0;
  for (const r of runs) {
    used += r.meters[meter] ?? 0;
    rows += r.done;
  }
  if (!used || !rows) return null;
  return { n: Math.floor(balance / (used / rows)), noun: pack.workUnit.many };
}

/** Daily totals per meter for a chart. */
export function dailySeries(pack: TenantPack, runs: RunRecord[], clock: string, days: number): { day: string; [meter: string]: number | string }[] {
  const out = Array.from({ length: days }, (_, i) => {
    const d = addDays(new Date(clock), i - days + 1);
    const row: { day: string; [meter: string]: number | string } = { day: d.toISOString().slice(0, 10) };
    for (const m of pack.meters) row[m.id] = 0;
    return row;
  });
  const idx = new Map(out.map((r, i) => [r.day, i]));
  for (const r of runs) {
    const i = idx.get(r.ts.slice(0, 10));
    if (i == null) continue;
    for (const [m, v] of Object.entries(r.meters)) out[i][m] = r2(Number(out[i][m] ?? 0) + v);
  }
  return out;
}

const csvCell = (v: string | number) => {
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function usageCsv(pack: TenantPack, hub: TenantState["hub"][string], runs: RunRecord[]): string {
  const head = ["date", "table", "column", "provider", "model", "member", "rows", "found", "not_found", "verified", "retries", ...pack.meters.map((m) => m.label.toLowerCase().replace(/\s+/g, "_")), "list_value_usd"];
  const lines = [head.join(",")];
  for (const r of [...runs].reverse())
    for (const c of r.columns)
      lines.push([r.ts.slice(0, 16).replace("T", " "), r.table, c.label, c.provider, c.model, memberName(hub, r.member), c.done, c.found, c.notFound, c.verified, c.retries, ...pack.meters.map((m) => c.meters[m.id] ?? 0), usdValue(pack, c.meters)].map(csvCell).join(","));
  return lines.join("\n");
}
