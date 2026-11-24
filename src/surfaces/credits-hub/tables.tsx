// Tables and the pre-run cost estimator (Phase 2 §2.3) plus the mid-run moment (§2.4).
// Adding an enrichment column opens an estimate; confirming places a hold; the run debits
// row by row and releases what it didn't use; running out pauses it cleanly with five ways on.
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Clock3, CreditCard, KeyRound, Layers, Minimize2, Plus, Rocket, Square, Table2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Progress } from "@/components/ui/progress";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { SectionTitle } from "@/ui/primitives";
import { ToneBadge } from "@/ui/tone";
import { useMoney } from "@/ui/money";
import { useFeature } from "@/ui/horizon";
import { usePay } from "@/surfaces/credits-hub/payments";
import { useHub } from "@/surfaces/credits-hub/hub-context";
import { RequestCreditsDialog, type RequestPrefill } from "@/surfaces/credits-hub/request-credits";
import { evalsFor } from "@/sim/evals";
import {
  addableColumns,
  advanceTableRun,
  allowOneMore,
  applyPlanChange,
  blockMoment,
  buyStarterPack,
  copy,
  buyTopUp,
  byokVariant,
  cheapestCover,
  cycleOf,
  earnBadge,
  estimateColumn,
  fmtDate,
  ladder,
  limitsFor,
  memberName,
  meterOf,
  planOf,
  previewPlanChange,
  primaryMeter,
  rateOf,
  resumeTableRun,
  rowCosts,
  rowOutcome,
  shrinkTableRun,
  startTableRun,
  stopTableRun,
  tablesOf,
  topUpAllowed,
  waitForReset,
  type TableDef,
  type TableRun,
  type TenantState,
} from "@/core";

const FIRST_ROWS = 50;

export function TablesTab() {
  const { t, account } = useHub();
  const tables = useMemo(() => tablesOf(t, account), [t, account]);
  const hub = t.hub[account];
  const pausedTable = hub.runs.find((r) => r.status === "paused" || r.status === "running")?.tableId;
  const [sel, setSel] = useState<string | null>(null);
  const current = tables.find((x) => x.id === sel) ?? tables.find((x) => x.id === pausedTable) ?? tables[0];
  if (!current) return <p className="type-body text-muted-foreground">No tables yet. Import a CSV or run a search to make one.</p>;
  return (
    <div className="grid grid-cols-1 gap-6 xl:grid-cols-[260px_minmax(0,1fr)]">
      <nav aria-label="Tables" className="min-w-0 space-y-2">
        <SectionTitle as="h3">Tables</SectionTitle>
        <ul className="flex gap-2 overflow-x-auto pb-1 xl:flex-col xl:overflow-visible">
          {tables.map((x) => {
            const runs = hub.runs.filter((r) => r.tableId === x.id);
            const paused = runs.some((r) => r.status === "paused");
            return (
              <li key={x.id} className="min-w-[200px] xl:min-w-0">
                <button type="button" onClick={() => setSel(x.id)} aria-current={x.id === current.id ? "true" : undefined} className={`w-full rounded-lg border p-3 text-left transition-colors ${x.id === current.id ? "border-primary bg-primary/5" : "border-border bg-card hover:bg-muted/50"}`}>
                  <div className="flex items-start justify-between gap-2">
                    <span className="type-body font-medium leading-snug">{x.name}</span>
                    {paused && <ToneBadge tone="atRisk">Paused</ToneBadge>}
                  </div>
                  <div className="type-caption text-muted-foreground">
                    {x.rows.toLocaleString("en-US")} {t.pack.workUnit.many} · {x.source}
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      </nav>
      <TableView key={current.id} table={current} />
    </div>
  );
}

function companyName(t: TenantState, i: number): string {
  const [a, b] = t.pack.demo.population.names;
  return `${a[(i * 7) % a.length]} ${b[(i * 11 + 3) % b.length]}`;
}

function TableView({ table }: { table: TableDef }) {
  const { t, account } = useHub();
  const hub = t.hub[account];
  const pack = t.pack;
  const [adding, setAdding] = useState(false);
  const runs = hub.runs.filter((r) => r.tableId === table.id).slice().reverse();
  const active = runs.find((r) => r.status === "running" || r.status === "paused" || r.status === "waiting");
  const last = runs[0];
  // The newest run first; any other run still paused or waiting stays visible below it.
  const others = runs.filter((r) => r.id !== last?.id && (r.status === "running" || r.status === "paused" || r.status === "waiting"));
  const cols = table.columns.map((id) => rateOf(pack, id)).filter((x): x is NonNullable<typeof x> => !!x);
  return (
    <section aria-labelledby={`tbl-${table.id}`} className="min-w-0 space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h3 id={`tbl-${table.id}`} className="type-heading">
            {table.name}
          </h3>
          <p className="type-caption text-muted-foreground">
            {table.rows.toLocaleString("en-US")} {pack.workUnit.many} · {table.source} · owner {memberName(hub, table.owner)}
          </p>
        </div>
        <Button size="sm" onClick={() => setAdding(true)} disabled={!!active && active.status === "running"}>
          <Plus aria-hidden="true" />
          {copy(pack, "tables.addColumn", "Add enrichment column")}
        </Button>
      </div>
      <div className="overflow-x-auto rounded-xl border border-border">
        <table className="w-full min-w-[520px] type-body">
          <caption className="sr-only">First rows of {table.name}</caption>
          <thead className="bg-muted/50 text-left type-caption text-muted-foreground">
            <tr>
              <th className="px-3 py-2 font-medium">#</th>
              <th className="px-3 py-2 font-medium">{copy(pack, "tables.rowLabel", "Company")}</th>
              {cols.map((c) => (
                <th key={c.id} className="px-3 py-2 font-medium">
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: Math.min(5, table.rows) }, (_, i) => (
              <tr key={i} className="border-t border-border">
                <td className="px-3 py-1.5 num text-muted-foreground">{i + 1}</td>
                <td className="px-3 py-1.5">{companyName(t, i + table.name.length)}</td>
                {cols.map((c) => {
                  const o = rowOutcome(`${table.id}:${c.id}`, i, c);
                  return (
                    <td key={c.id} className="px-3 py-1.5">
                      <span className={o.found ? "text-foreground" : "text-muted-foreground"}>{c.verifiedShare != null ? (o.verified ? "Verified" : o.found ? "Found" : "Not found · free") : !c.chargeOnHit ? "Done" : o.found ? "Found" : "Not found · free"}</span>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {adding && <AddColumn table={table} onClose={() => setAdding(false)} />}
      {last && <RunPanel run={last} table={table} />}
      {others.map((r) => (
        <RunPanel key={r.id} run={r} table={table} />
      ))}
      {runs.length > 1 + others.length && (
        <details className="rounded-lg border border-border p-3">
          <summary className="cursor-pointer type-body font-medium">Earlier runs on this table ({runs.length - 1 - others.length})</summary>
          <ul className="mt-2 space-y-1 type-caption text-muted-foreground">
            {runs
              .filter((r) => r.id !== last?.id && !others.includes(r))
              .map((r) => (
                <li key={r.id}>
                  {fmtDate(r.startedAt)} · {r.column} · {r.done.toLocaleString("en-US")} of {r.rows.toLocaleString("en-US")} · {r.status}
                </li>
              ))}
          </ul>
        </details>
      )}
    </section>
  );
}

/** Run horizon: a cheaper model for AI columns that passed the tenant's evals within 2 quality points. */
function cheaperModel(t: TenantState, stepId: string): { stepId: string; label: string; quality: number; base: number; saves: number } | null {
  const cfg = t.pack.demo.sim;
  if (!cfg) return null;
  const e = cfg.enrichments.find((x) => x.models.length && Object.values(x.modelSteps).includes(stepId));
  if (!e) return null;
  const { runs } = evalsFor(t.pack, cfg, new Date(t.clock));
  const prim = primaryMeter(t.pack).id;
  const cur = Object.entries(e.modelSteps).find(([, s]) => s === stepId)?.[0];
  const base = runs.find((r) => r.suiteId === `${e.id}-quality` && r.model === cur);
  if (!base) return null;
  const curCost = rateOf(t.pack, stepId)?.costs[prim] ?? 0;
  const options = runs
    .filter((r) => r.suiteId === base.suiteId && r.model !== cur && base.passRate - r.passRate <= 0.02)
    .map((r) => ({ r, step: e.modelSteps[r.model], cost: rateOf(t.pack, e.modelSteps[r.model] ?? "")?.costs[prim] ?? Infinity }))
    .filter((x) => x.step && x.cost < curCost)
    .sort((a, b) => a.cost - b.cost);
  const best = options[0];
  if (!best) return null;
  return { stepId: best.step, label: rateOf(t.pack, best.step)!.label, quality: Math.round(best.r.passRate * 100), base: Math.round(base.passRate * 100), saves: Math.round((1 - best.cost / curCost) * 100) };
}

function AddColumn({ table, onClose }: { table: TableDef; onClose: () => void }) {
  const { t, account, viewer, act, goTab } = useHub();
  const { amountText, fmtUsd } = useMoney();
  const runHorizon = useFeature("hub.cheaperModel");
  const pack = t.pack;
  const hub = t.hub[account];
  const plan = planOf(pack, hub.planId);
  const options = addableColumns(pack);
  const [stepId, setStepId] = useState(options.find((o) => !table.columns.includes(o.id))?.id ?? options[0].id);
  const [scope, setScope] = useState<"all" | "first">("all");
  const [byok, setByok] = useState(false);
  const [ask, setAsk] = useState<RequestPrefill | null>(null);
  const variant = byokVariant(pack, stepId);
  const effStep = byok && variant ? variant.id : stepId;
  const rows = scope === "first" ? Math.min(FIRST_ROWS, table.rows) : table.rows;
  const est = estimateColumn(t, account, viewer.id, table, effStep, rows);
  const cheaper = runHorizon ? cheaperModel(t, stepId) : null;
  const overCap = est.rowCap != null && rows > est.rowCap;
  const block = est.blocks[0];
  const bm = block ? blockMoment(pack, block, (n) => fmtUsd(n, 0)) : null;
  const prim = primaryMeter(pack);
  const costs = rowCosts(pack, est.item);

  const confirm = () => {
    const firstEstimate = !hub.rewardState.badges.some((b) => b.id === "estimator");
    const result = act(
      (s) => {
        const r = startTableRun(s, account, { member: viewer.id, table, stepId: effStep, rows, byok: byok && !!variant });
        if (!r.result.ok) return r;
        let next = r.state;
        if (firstEstimate) next = earnBadge(next, account, "estimator", viewer.actor).state;
        if (byok && variant) next = earnBadge(next, account, "own-key", viewer.actor).state;
        return { state: next, result: r.result };
      },
      (r) => (r.ok ? { ok: true, text: `Hold placed. ${est.item.label} is running on ${rows.toLocaleString("en-US")} ${pack.workUnit.many}.` } : { ok: false, text: typeof r.reason === "string" ? r.reason : blockMoment(pack, r.reason).headline }),
    );
    if (result?.ok) onClose();
  };

  return (
    <section aria-labelledby="add-col-title" className="space-y-4 rounded-xl border border-primary/40 bg-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h4 id="add-col-title" className="type-heading">
            Estimate before you run
          </h4>
          <p className="type-caption text-muted-foreground">Nothing is charged until you confirm. Confirming holds the high end of the range and releases what the run doesn't use.</p>
        </div>
        <Button size="sm" variant="ghost" onClick={onClose}>
          Close
        </Button>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="col-pick">Enrichment column</Label>
            <NativeSelect id="col-pick" className="w-full" value={stepId} onChange={(e) => { setStepId(e.target.value); setByok(false); }}>
              {options.map((o) => (
                <NativeSelectOption key={o.id} value={o.id}>
                  {o.label}
                  {o.requires && !plan.features.includes(o.requires) ? ` (needs ${o.requires.toUpperCase()})` : ""}
                </NativeSelectOption>
              ))}
            </NativeSelect>
            <p className="type-caption text-muted-foreground">
              {pack.meters
                .filter((m) => costs[m.id].hit > 0)
                .map((m) => `${amountText(m, costs[m.id].hit)}${costs[m.id].miss === 0 && costs[m.id].hit > 0 ? " when found" : ""}`)
                .join(" + ")}{" "}
              per {pack.workUnit.one} · {est.item.provider ?? pack.company}
            </p>
          </div>
          <fieldset className="space-y-2">
            <legend className="type-body font-medium">Rows</legend>
            <RadioGroup value={scope} onValueChange={(v) => setScope(v as "all" | "first")}>
              <div className="flex items-center gap-2">
                <RadioGroupItem id="rows-all" value="all" />
                <Label htmlFor="rows-all" className="font-normal">
                  All {table.rows.toLocaleString("en-US")} {pack.workUnit.many}
                </Label>
              </div>
              <div className="flex items-center gap-2">
                <RadioGroupItem id="rows-first" value="first" />
                <Label htmlFor="rows-first" className="font-normal">
                  Run on the first {Math.min(FIRST_ROWS, table.rows)} rows to check quality
                </Label>
              </div>
            </RadioGroup>
          </fieldset>
          {variant ? (
            <div className="flex items-start justify-between gap-3 rounded-lg border border-border p-3">
              <div>
                <Label htmlFor="byok">Use my own API key</Label>
                <p className="type-caption text-muted-foreground">{prim.label} drop to zero on this column; {pack.meters.slice(1).map((m) => m.label).join(", ") || "platform"} costs remain.</p>
              </div>
              <Switch id="byok" checked={byok} onCheckedChange={setByok} />
            </div>
          ) : (
            <p className="type-caption text-muted-foreground">No own-key option for {est.item.label}.</p>
          )}
          {cheaper && (
            <div className="space-y-2 rounded-lg border border-dashed border-border p-3">
              <p className="type-body">
                <span className="font-medium">{cheaper.label}</span> passed {pack.company}'s evals at {cheaper.quality}% against {cheaper.base}% for the current model (within 2 points) and costs {cheaper.saves}% less {prim.label}.
              </p>
              <Button size="sm" variant="outline" onClick={() => setStepId(cheaper.stepId)}>
                Use {cheaper.label}
              </Button>
            </div>
          )}
        </div>
        <div className="space-y-3" aria-live="polite">
          <dl className="space-y-2 rounded-lg bg-muted/50 p-3 type-body">
            {est.meters.map((m) => {
              const meter = meterOf(pack, m.meter);
              if (m.high <= 0) return null;
              return (
                <div key={m.meter} className="space-y-0.5">
                  <dt className="type-caption text-muted-foreground">{meter.label} for {rows.toLocaleString("en-US")} {pack.workUnit.many}</dt>
                  <dd className="num">
                    <span className="font-semibold">
                      {m.low === m.high ? amountText(meter, m.expected) : `${amountText(meter, m.low, { label: false })}–${amountText(meter, m.high)}`}
                    </span>
                    <span className="text-muted-foreground"> · hold {amountText(meter, m.hold, { label: false })} · {m.after >= 0 ? `${amountText(meter, m.after, { label: false })} left after` : `short by ${amountText(meter, -m.after, { label: false })}`}</span>
                  </dd>
                </div>
              );
            })}
            <div className="border-t border-border pt-2 type-caption text-muted-foreground">
              {est.item.chargeOnHit
                ? `About ${Math.round(est.notFoundShare * 100)}% won't be found, and those are free. Expect ~${est.expectedFound.toLocaleString("en-US")} found${est.expectedVerified ? `, ~${est.expectedVerified.toLocaleString("en-US")} verified` : ""}.`
                : `Every ${pack.workUnit.one} is charged.`}{" "}
              List value {fmtUsd(est.usd.low)}–{fmtUsd(est.usd.high)}.
            </div>
          </dl>
          {est.fitsRows < rows && !block && (
            <p className="type-body text-watch-ink">
              Your balance covers about {est.fitsRows.toLocaleString("en-US")} of {rows.toLocaleString("en-US")} rows.{" "}
              {hub.autoTopUp.enabled && est.limitedBy === hub.autoTopUp.meter ? "Auto top-up can add more within your monthly cap; if it can't, the run pauses there with nothing lost." : "The run pauses there with nothing lost, and you choose how to finish."}
            </p>
          )}
          {est.warnings.map((w) => (
            <p key={w} className="type-caption text-watch-ink">
              {w}
            </p>
          ))}
          {overCap && <p className="type-body text-watch-ink">{plan.name} runs up to {est.rowCap?.toLocaleString("en-US")} rows per table. Run the first {FIRST_ROWS}, or compare plans.</p>}
          {est.feature && <p className="type-body text-watch-ink">{est.item.label} needs a plan with {est.feature.toUpperCase()}.</p>}
          {bm && (
            <div role="alert" className="space-y-2 rounded-lg border border-watch-ink/30 bg-watch-soft p-3">
              <p className="type-body font-medium">{bm.headline}</p>
              <p className="type-caption">{bm.evidence}</p>
              {viewer.can("limits") || viewer.can("payment") ? (
                <Button size="sm" variant="outline" onClick={() => goTab(bm.action.kind === "billing" ? "billing" : "limits")}>
                  {bm.action.label}
                </Button>
              ) : (
                <Button size="sm" onClick={() => setAsk({ meter: block?.code === "spend_limit" ? block.meter : prim.id, amount: Math.ceil((est.meters[0]?.high ?? 100) / 5) * 5, reason: `Add ${est.item.label} to ${table.name} (${rows.toLocaleString("en-US")} rows).` })}>
                  Request credits
                </Button>
              )}
            </div>
          )}
          <Button className="w-full" disabled={!!block || overCap || !!est.feature || est.fitsRows === 0} onClick={confirm}>
            Hold {est.meters.filter((m) => m.hold > 0).map((m) => amountText(meterOf(pack, m.meter), m.hold)).join(" + ") || "credits"} and run
          </Button>
          {est.fitsRows === 0 && !block && <p className="type-caption text-muted-foreground">No balance left to start this run. Top up, wait for the reset on {fmtDate(cycleOf(t).end)}, or use your own key.</p>}
        </div>
      </div>
      {ask && <RequestCreditsDialog open onOpenChange={(v) => !v && setAsk(null)} prefill={ask} />}
    </section>
  );
}

function RunPanel({ run: r, table }: { run: TableRun; table: TableDef }) {
  const { t, account, silent } = useHub();
  const { amountText } = useMoney();
  const pack = t.pack;
  const pct = r.rows ? Math.round((r.done / r.rows) * 100) : 0;

  useEffect(() => {
    if (r.status !== "running") return;
    const prefersReduced = !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const chunk = prefersReduced ? r.rows : Math.max(1, Math.ceil(r.rows / 36));
    const id = window.setInterval(() => silent((s) => advanceTableRun(s, account, r.id, chunk).state), prefersReduced ? 50 : 140);
    return () => window.clearInterval(id);
  }, [r.status, r.id, r.rows, account, silent]);

  const status =
    r.status === "running"
      ? `Running · row ${r.done.toLocaleString("en-US")} of ${r.rows.toLocaleString("en-US")}`
      : r.status === "paused"
        ? `Paused at row ${r.done.toLocaleString("en-US")} of ${r.rows.toLocaleString("en-US")}, nothing lost`
        : r.status === "waiting"
          ? `Waiting for the reset on ${fmtDate(r.resumeAt!)} · row ${r.done.toLocaleString("en-US")} of ${r.rows.toLocaleString("en-US")}`
          : r.status === "stopped"
            ? `Stopped at row ${r.done.toLocaleString("en-US")}; the rest weren't run or charged`
            : `Finished · ${r.found.toLocaleString("en-US")} of ${r.rows.toLocaleString("en-US")} found${r.verified ? `, ${r.verified.toLocaleString("en-US")} verified` : ""}`;

  return (
    <section aria-label={`${r.column} run`} className={`space-y-3 rounded-xl border bg-card p-4 ${r.status === "paused" ? "border-at-risk-ink/40" : "border-border"}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h4 className="type-heading" aria-live="polite">
            {status}
          </h4>
          <p className="type-caption text-muted-foreground">
            {r.column}
            {r.byok && !/own/i.test(r.column) ? " · your own key" : ""} · started {fmtDate(r.startedAt)}
            {r.segments > 1 ? ` · ${r.segments} segments` : ""}
          </p>
        </div>
        <ToneBadge tone={r.status === "done" ? "healthy" : r.status === "paused" ? "atRisk" : r.status === "running" ? "info" : "neutral"}>{r.status === "done" ? "Done" : r.status[0].toUpperCase() + r.status.slice(1)}</ToneBadge>
      </div>
      <Progress value={pct} aria-label={`${r.done} of ${r.rows} rows`} />
      <dl className="grid grid-cols-2 gap-x-4 gap-y-1 type-body sm:grid-cols-4">
        <div>
          <dt className="type-caption text-muted-foreground">Found</dt>
          <dd className="num">{r.found.toLocaleString("en-US")}</dd>
        </div>
        <div>
          <dt className="type-caption text-muted-foreground">Not found · free</dt>
          <dd className="num">{r.notFound.toLocaleString("en-US")}</dd>
        </div>
        {pack.meters.map((m) => (
          <div key={m.id}>
            <dt className="type-caption text-muted-foreground">{m.label} used</dt>
            <dd className="num font-medium">{amountText(m, r.used[m.id] ?? 0, { label: false })}</dd>
          </div>
        ))}
      </dl>
      {r.status === "running" && Object.keys(r.held).length > 0 && (
        <p className="type-caption text-muted-foreground">
          Held for this run:{" "}
          {pack.meters
            .filter((m) => r.held[m.id])
            .map((m) => `${amountText(m, Math.max(0, r.held[m.id] - (r.drawn[m.id] ?? 0)))} of ${amountText(m, r.held[m.id], { label: false })} still reserved`)
            .join(" · ")}
        </p>
      )}
      {(r.status === "done" || r.status === "stopped" || r.status === "paused") && Object.values(r.released).some((v) => v > 0) && (
        <p className="type-body text-healthy-ink">
          Released back to your balance:{" "}
          {pack.meters
            .filter((m) => (r.released[m.id] ?? 0) > 0)
            .map((m) => amountText(m, r.released[m.id]))
            .join(" and ")}
          .
        </p>
      )}
      {r.status === "paused" && <PausedOptions run={r} table={table} />}
      {r.status === "running" && <StopButton run={r} />}
      {r.status === "waiting" && <WaitingActions run={r} />}
    </section>
  );
}

function StopButton({ run: r }: { run: TableRun }) {
  const { account, viewer, run } = useHub();
  return (
    <Button size="sm" variant="outline" onClick={() => run((s) => stopTableRun(s, account, r.id, viewer.actor).state, `Stopped at row ${r.done.toLocaleString("en-US")}. The unused hold was released.`)}>
      <Square aria-hidden="true" />
      Stop and keep what's done
    </Button>
  );
}

function WaitingActions({ run: r }: { run: TableRun }) {
  const { account, viewer, run } = useHub();
  return (
    <div className="flex flex-wrap gap-2">
      <p className="w-full type-caption text-muted-foreground">It picks up at row {(r.done + 1).toLocaleString("en-US")} automatically when the new credits arrive. You'll get an e-mail when it finishes.</p>
      <Button size="sm" variant="outline" onClick={() => run((s) => stopTableRun(s, account, r.id, viewer.actor).state, "Stopped. The enriched rows stay in the table.")}>
        Don't resume, keep what's done
      </Button>
    </div>
  );
}

function PausedOptions({ run: r }: { run: TableRun; table: TableDef }) {
  const { t, account, viewer, run, act, goTab } = useHub();
  const { amountText, fmtUsd, charged, price } = useMoney();
  const pay = usePay();
  const [ask, setAsk] = useState<RequestPrefill | null>(null);
  const pack = t.pack;
  const hub = t.hub[account];
  const plan = planOf(pack, hub.planId);
  const { end } = cycleOf(t);
  const item = rateOf(pack, r.stepId)!;
  const left = r.rows - r.done;
  const reason = r.pausedReason;
  const meterId = reason?.code === "insufficient_balance" ? reason.meter : reason?.code === "spend_limit" ? reason.meter : primaryMeter(pack).id;
  const m = meterOf(pack, meterId);
  const costs = rowCosts(pack, item);
  const p = item.chargeOnHit ? item.hitRate : 1;
  const perRow = p * costs[meterId].hit + (1 - p) * costs[meterId].miss;
  const need = Math.ceil(left * perRow);
  const est = estimateColumn(t, account, r.member, { id: r.tableId, name: r.table }, r.stepId, left);
  const fitsRaw = Math.min(left, est.fitsRows);
  const fits = fitsRaw >= 10 ? fitsRaw : 0;
  const cover = cheapestCover(pack, meterId, need);
  const canTop = viewer.can("buy") && topUpAllowed(pack, meterId, plan, "cockpit") && !!cover;
  const sp = pack.hub.starterPack;
  const variant = byokVariant(pack, r.stepId);
  const byokCost = variant ? pack.meters.filter((x) => (variant.costs[x.id] ?? 0) > 0).map((x) => amountText(x, left * (variant.costs[x.id] ?? 0))).join(" + ") : "";
  const next = ladder(pack, "cockpit").find((x) => x.paid && x.price != null && (x.price ?? 0) > (plan.price ?? 0) && (!item.requires || x.features.includes(item.requires)));
  const pv = next ? previewPlanChange(t, account, { planId: next.id, billing: hub.profile.billing, addOns: {} }) : null;
  const resume = (how: "continue" | "byok") => (s: TenantState) => {
    const r1 = resumeTableRun(s, account, r.id, how, viewer.actor);
    return r1.result.ok ? r1.state : s;
  };
  const limitBlock = reason?.code === "spend_limit";
  const overdue = reason?.code === "payment_overdue";
  const bm = reason ? blockMoment(pack, reason, (n) => fmtUsd(n, 0)) : null;

  return (
    <div className="space-y-3">
      <p className="type-body">
        {reason?.code === "insufficient_balance"
          ? `${m.label} ran out at row ${r.done.toLocaleString("en-US")}; ${amountText(m, Math.max(0, est.meters.find((x) => x.meter === meterId)?.balance ?? 0))} left.${hub.capAsk ? ` Auto top-up stopped at your ${fmtUsd(hub.topUpCap, 0)} monthly cap.` : ""} Nothing was charged for rows that didn't run.`
          : (bm?.evidence ?? "The run paused.")}{" "}
        The {r.done.toLocaleString("en-US")} enriched rows are saved. Finishing the other {left.toLocaleString("en-US")} needs about {amountText(m, need)}.
      </p>
      <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
        {limitBlock || overdue ? null : canTop ? (
          <Option icon={Layers} title={`Top up ${amountText(m, cover!.units)}`} meta={`${price(cover!.price)} once · ${price(cover!.perCredit, 3)} per credit${cover!.validityDays ? ` · valid ${cover!.validityDays} days` : ""}`}>
            <Button size="sm" onClick={() => pay({ usd: cover!.price, label: `${amountText(m, cover!.units)} top-up`, apply: (s) => resume("continue")(buyTopUp(s, account, meterId, cover!.units).state), okText: `${amountText(m, cover!.units)} added for ${charged(cover!.price)}. Picking up at row ${(r.done + 1).toLocaleString("en-US")}.` })}>
              Top up and continue
            </Button>
          </Option>
        ) : !viewer.can("buy") ? (
          <Option icon={Layers} title="Request credits" meta={`${amountText(m, need)} · about ${fmtUsd(need * (cover ? cover.perCredit : m.pricePerUnit))}`}>
            <Button size="sm" onClick={() => setAsk({ meter: meterId, amount: Math.ceil((est.meters.find((x) => x.meter === meterId)?.high ?? need) / 5) * 5, reason: `Finish ${r.column} on ${r.table}: paused at row ${r.done.toLocaleString("en-US")} of ${r.rows.toLocaleString("en-US")}.` })}>
              Request credits
            </Button>
          </Option>
        ) : null}
        {hub.capAsk && viewer.can("buy") && !limitBlock && !overdue && (
          <Option icon={Layers} title="Allow one more auto top-up" meta={`${price(hub.capAsk.usd)} · raises this month's cap to ${fmtUsd(hub.topUpCap + hub.capAsk.usd, 0)}`}>
            <Button size="sm" onClick={() => run((s) => resume("continue")(allowOneMore(s, account, viewer.actor).state), `Cap raised by ${fmtUsd(hub.capAsk!.usd)}. Picking up at row ${(r.done + 1).toLocaleString("en-US")}.`)}>
              Allow and continue
            </Button>
          </Option>
        )}
        {sp && !plan.paid && viewer.can("buy") && !limitBlock && !overdue && (
          <Option icon={Rocket} title={`Starter pack: ${amountText(primaryMeter(pack), sp.units)}`} meta={`${price(sp.price)} once · ${price(sp.price / sp.units, 3)} per credit${sp.validityDays ? ` · valid ${sp.validityDays} days` : ""}`}>
            <Button size="sm" variant={canTop ? "outline" : "default"} onClick={() => pay({ usd: sp.price, label: "Starter pack", apply: (s) => resume("continue")(buyStarterPack(s, account).state), okText: `Starter pack added. Picking up at row ${(r.done + 1).toLocaleString("en-US")}.` })}>
              Buy and continue
            </Button>
          </Option>
        )}
        {reason?.code === "insufficient_balance" && (
          <Option icon={Clock3} title={`Wait for the reset on ${fmtDate(end)}`} meta="Free · resumes by itself when credits arrive">
            <Button size="sm" variant="outline" onClick={() => run((s) => waitForReset(s, account, r.id, viewer.actor).state, `It resumes on ${fmtDate(end)} at row ${(r.done + 1).toLocaleString("en-US")}.`)}>
              Resume at reset
            </Button>
          </Option>
        )}
        {variant && !overdue && (
          <Option icon={KeyRound} title="Finish on your own API key" meta={`0 ${primaryMeter(pack).label}${byokCost ? ` · ${byokCost}` : ""}`}>
            <Button size="sm" variant="outline" onClick={() => act((s) => { const r1 = resumeTableRun(s, account, r.id, "byok", viewer.actor); return r1.result.ok ? { state: earnBadge(r1.state, account, "own-key", viewer.actor).state, result: r1.result } : r1; }, (x) => ({ ok: x.ok, text: x.ok ? `Continuing on your own key from row ${(r.done + 1).toLocaleString("en-US")}.` : x.why ?? "Couldn't resume." }))}>
              Use my key
            </Button>
          </Option>
        )}
        {!overdue && (
          <Option icon={Minimize2} title={fits > 0 ? `Run ${fits.toLocaleString("en-US")} more rows, then stop` : `Keep the ${r.done.toLocaleString("en-US")} rows and stop`} meta={fits > 0 ? `Uses what's left · ${price(perRow * (cover ? cover.perCredit : m.pricePerUnit), 3)} a row at list` : "Nothing else is charged"}>
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                fits > 0
                  ? act((s) => shrinkTableRun(s, account, r.id, fits, viewer.actor), (x) => ({ ok: x.ok, text: x.ok ? `Running ${fits.toLocaleString("en-US")} more rows, then it stops.` : x.why ?? "Couldn't resume." }))
                  : run((s) => stopTableRun(s, account, r.id, viewer.actor).state, `Kept ${r.done.toLocaleString("en-US")} rows.`)
              }
            >
              Run smaller
            </Button>
          </Option>
        )}
        {next && pv && viewer.can("plan") && !overdue && (
          <Option icon={CreditCard} title={`Upgrade to ${next.name}`} meta={`${fmtUsd(pv.prorationUsd)} today for the ${pv.daysLeft} days left, then ${price(next.price ?? 0, 0)}/mo · +${amountText(m, pv.grantsNow[meterId] ?? 0)} now`}>
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                pay({
                  usd: pv.prorationUsd,
                  label: `Upgrade to ${next.name}`,
                  apply: (s) => {
                    const up = applyPlanChange(s, account, { planId: next.id, billing: hub.profile.billing, addOns: {} }, viewer.actor);
                    return up.result.ok ? resume("continue")(up.state) : s;
                  },
                  okText: `You're on ${next.name}. Picking up at row ${(r.done + 1).toLocaleString("en-US")}. You can undo within ${pack.hub.undoHours} hours in Plan.`,
                })
              }
            >
              See proration and upgrade
            </Button>
          </Option>
        )}
        {limitBlock && (
          <LimitOption run={r} meterId={meterId} need={need} onAsk={() => setAsk({ meter: meterId, amount: Math.ceil((est.meters.find((x) => x.meter === meterId)?.high ?? need) / 5) * 5, reason: `Finish ${r.column} on ${r.table}: paused at row ${r.done.toLocaleString("en-US")} of ${r.rows.toLocaleString("en-US")} at my limit.` })} onResume={() => run(resume("continue"), `Resumed at row ${(r.done + 1).toLocaleString("en-US")}.`)} />
        )}
        {overdue && viewer.can("payment") && (
          <Option icon={Table2} title="Update the card" meta="Runs resume once the renewal is paid">
            <Button size="sm" variant="outline" onClick={() => goTab("billing")}>
              Go to Billing
            </Button>
          </Option>
        )}
      </ul>
      {ask && <RequestCreditsDialog open onOpenChange={(v) => !v && setAsk(null)} prefill={ask} />}
    </div>
  );
}

/** A run paused at a blocking limit: resume once it's raised; otherwise a Member asks and an admin raises it. */
function LimitOption({ run: r, meterId, need, onAsk, onResume }: { run: TableRun; meterId: string; need: number; onAsk: () => void; onResume: () => void }) {
  const { t, account, viewer, goTab } = useHub();
  const { amountText } = useMoney();
  const hub = t.hub[account];
  const still = limitsFor(hub, t.events, account, cycleOf(t).start, { member: r.member, tableId: r.tableId, table: r.table }).find((l) => l.state === "block");
  const mine = hub.requests.filter((q) => q.from === viewer.id).slice(-1)[0];
  const m = meterOf(t.pack, meterId);
  if (!still)
    return (
      <Option icon={Table2} title="The limit has room again" meta={mine?.status === "approved" ? `Approved: ${mine.note ?? ""}` : "Raised or reset since the pause"}>
        <Button size="sm" onClick={onResume}>
          Resume run
        </Button>
      </Option>
    );
  if (viewer.can("limits"))
    return (
      <Option icon={Table2} title="Raise or clear the limit" meta={`${amountText(m, still.spent)} of ${amountText(m, still.limit.amount)} used · about ${amountText(m, need)} more to finish`}>
        <Button size="sm" variant="outline" onClick={() => goTab("limits")}>
          Open Limits
        </Button>
      </Option>
    );
  return (
    <Option icon={Layers} title={mine?.status === "pending" ? "Request sent" : "Request credits"} meta={mine?.status === "pending" ? `Waiting for ${hub.team.filter((x) => x.role === "admin").map((x) => x.name).join(", ")} · sent ${fmtDate(mine.ts)}` : `${amountText(m, need)} to finish · goes to the admins by e-mail and chat`}>
      <Button size="sm" disabled={mine?.status === "pending"} onClick={onAsk}>
        {mine?.status === "pending" ? "Waiting for approval" : "Request credits"}
      </Button>
    </Option>
  );
}

function Option({ icon: Icon, title, meta, children }: { icon: typeof Layers; title: string; meta: string; children: ReactNode }) {
  return (
    <li className="flex flex-col justify-between gap-3 rounded-lg border border-border bg-background p-3">
      <div className="flex gap-2.5">
        <Icon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0">
          <div className="type-body font-medium leading-snug">{title}</div>
          <div className="type-caption text-muted-foreground">{meta}</div>
        </div>
      </div>
      <div>{children}</div>
    </li>
  );
}
