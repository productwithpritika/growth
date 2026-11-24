// Eval results experience (Phase 6 §6.4–6.8): run form with rubric editor and the synthetic test
// tenant, leaderboard with intervals, suites matrix, cost–quality frontier with the Pareto line,
// per-example drill-down, failure clusters, model right-sizing with the scenario slider, the
// quality gate with audited overrides, and the regression watch.
import { useMemo, useState } from "react";
import { CartesianGrid, ErrorBar, Line, LineChart, ReferenceLine, Scatter, ScatterChart, XAxis, YAxis, ZAxis } from "recharts";
import { Bot, FlaskConical, MessagesSquare, Plus, ShieldAlert, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Range } from "@/ui/range";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { SectionTitle, Stat } from "@/ui/primitives";
import { ToneBadge } from "@/ui/tone";
import { ApprovalSheet } from "@/ui/approval-sheet";
import type { Tone } from "@/core/types";
import { fmtDate, fmtNum, fmtUsd } from "@/core/format";
import { usePlatform } from "@/surfaces/platform/use-platform";
import {
  driftSeries,
  examples,
  failureClusters,
  fmtQ,
  gateFor,
  impactOf,
  latestRun,
  modelName,
  monthUsed,
  pareto,
  recommend,
  runCost,
  runResult,
  sandboxTenant,
  suiteLabel,
  SUITES,
  suitesFor,
} from "@/platform/evals";
import { createModelExperiment, decideOverride, providerChange, requestOverride, routeAlert, setRubric, setSchedule, setSkillDefault, startRun } from "@/platform/eval-actions";
import type { GateState, RubricCriterion, SuiteId } from "@/platform/types";

const GATE_TONE: Record<GateState, Tone> = { pass: "healthy", warn: "watch", fail: "blocked", none: "neutral" };
const GATE_TEXT: Record<GateState, string> = { pass: "Pass", warn: "Warn", fail: "Fail", none: "No eval" };

export function GateBadge({ state }: { state: GateState }) {
  return <ToneBadge tone={GATE_TONE[state]}>Gate: {GATE_TEXT[state]}</ToneBadge>;
}

const signed = (x: number, d = 1) => `${x >= 0 ? "+" : "−"}${Math.abs(x).toFixed(d)}`;

// ------------------------------------------------------------------ runs and results

export function ResultsPanel({ skillId }: { skillId: string }) {
  const { t, act, who, askCb } = usePlatform();
  const ev = t.platform.evals;
  const skill = ev.skills.find((s) => s.id === skillId);
  const runs = ev.runs.filter((r) => r.skillId === skillId).sort((a, b) => b.at.localeCompare(a.at));
  const [runId, setRunId] = useState<string | null>(null);
  const run = runs.find((r) => r.id === runId) ?? runs[0] ?? null;
  const res = useMemo(() => (run ? runResult(ev, run, t.pack) : null), [ev, run, t.pack]);
  const datasets = ev.datasets.filter((d) => d.skillId === skillId);
  const [dsId, setDsId] = useState<string>("");
  const ds = datasets.find((d) => d.id === dsId) ?? datasets[0];
  const allowed = skill?.manifest.allowedModels ?? [];
  const [models, setModels] = useState<string[] | null>(null);
  const picked = models ?? allowed;
  const [repeats, setRepeats] = useState(3);
  const suites: SuiteId[] = skill && ds ? suitesFor(skill, ds) : [];
  const cost = ds ? runCost(ds.rows, new Set([skill?.manifest.defaultModel, ...picked]).size, repeats, suites.length) : 0;
  const left = ev.budget.monthly - monthUsed(ev, t.clock);
  const [candidate, setCandidate] = useState<string | null>(null);
  if (!skill) return null;
  const cand = candidate && res?.models.some((m) => m.model === candidate) ? candidate : (res?.models.find((m) => m.model !== res.defaultModel)?.model ?? skill.manifest.defaultModel);
  const start = () => {
    if (!ds) return;
    const r = act((s) => startRun(s, { skillId, datasetId: ds.id, models: picked, suites, repeats, by: who, trigger: "manual" }));
    if (r?.ok && r.id) setRunId(r.id);
  };
  const box = run ? sandboxTenant(t.pack, run) : null;
  const pts = res ? res.models.map((m) => ({ x: Math.round(m.costShare * 100), y: Math.round(m.quality.mean * 10) / 10, err: [Math.round((m.quality.mean - m.quality.lo) * 10) / 10, Math.round((m.quality.hi - m.quality.mean) * 10) / 10], name: modelName(m.model) })) : [];
  const front = res ? pareto(res.models) : [];
  const frontPts = res ? res.models.filter((m) => front.includes(m.model)).sort((a, b) => a.costShare - b.costShare).map((m) => ({ x: Math.round(m.costShare * 100), y: Math.round(m.quality.mean * 10) / 10, name: modelName(m.model) })) : [];
  const clusters = res ? failureClusters(res, cand) : [];
  const exs = res ? examples(res, cand, 6) : [];
  return (
    <div className="space-y-6">
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
        <section aria-labelledby="run-h" className="space-y-3 rounded-xl border border-border bg-card p-4">
          <h3 id="run-h" className="type-heading">Run an eval · {skill.manifest.name}</h3>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="run-ds">Dataset</Label>
              <NativeSelect id="run-ds" value={ds?.id ?? ""} onChange={(e) => setDsId(e.target.value)}>
                {datasets.map((d) => (
                  <NativeSelectOption key={d.id} value={d.id}>
                    {d.name} · {fmtNum(d.rows)} rows
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </div>
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label htmlFor="run-rep">Repeat runs</Label>
                <span className="num type-caption">{repeats}×</span>
              </div>
              <Range id="run-rep" min={1} max={5} step={1} value={repeats} onValueChange={(x) => setRepeats(x)} aria-label="Repeat runs" />
            </div>
          </div>
          <fieldset className="space-y-1.5">
            <legend className="type-caption font-medium">Models</legend>
            <div className="flex flex-wrap gap-3">
              {allowed.map((m) => (
                <label key={m} className="flex items-center gap-2 type-body">
                  <Checkbox checked={picked.includes(m) || m === skill.manifest.defaultModel} disabled={m === skill.manifest.defaultModel} onCheckedChange={(v) => setModels(v ? [...new Set([...picked, m])] : picked.filter((x) => x !== m))} />
                  {modelName(m)}
                  {m === skill.manifest.defaultModel ? " (default)" : ""}
                </label>
              ))}
            </div>
          </fieldset>
          <p className="type-caption text-muted-foreground">Suites: {suites.map(suiteLabel).join(", ")}.</p>
          <div className="flex flex-wrap items-center gap-3">
            <Button onClick={start} disabled={!ds || cost > left}>
              <FlaskConical aria-hidden="true" />
              Run eval · {fmtNum(cost)} eval credits
            </Button>
            {cost > left && <span className="type-caption text-blocked-ink">Over the {fmtNum(left)} eval credits left this month.</span>}
          </div>
          <RubricEditor skillId={skillId} />
        </section>
        <section aria-labelledby="sbx-h" className="space-y-2 rounded-xl border border-border bg-card p-4">
          <h3 id="sbx-h" className="type-heading">Synthetic test tenant</h3>
          {box ? (
            <>
              <p className="font-mono type-caption">{box.id}</p>
              <ul className="space-y-1 type-body">
                <li>Mirrors {t.pack.company}: {box.plans} plans, meters {box.meters.join(" and ")}</li>
                <li>Limits: {box.limits}</li>
                <li>{box.users} simulated users running {box.workflows} workflows</li>
                <li className="font-medium text-healthy-ink">Isolated: nothing touches production</li>
              </ul>
              <p className="type-caption text-muted-foreground">
                Run {fmtDate(run!.at)} by {run!.by} · {run!.trigger === "manual" ? "manual" : run!.trigger.replace("-", " ")} · {fmtNum(run!.credits)} eval credits
              </p>
            </>
          ) : (
            <p className="type-body text-muted-foreground">Each run provisions one.</p>
          )}
          {runs.length > 1 && (
            <div className="space-y-1.5 pt-2">
              <Label htmlFor="run-pick">Run history</Label>
              <NativeSelect id="run-pick" value={run?.id ?? ""} onChange={(e) => setRunId(e.target.value)}>
                {runs.map((r) => (
                  <NativeSelectOption key={r.id} value={r.id}>
                    {fmtDate(r.at)} · {r.models.length} models · {r.repeats}× · {r.trigger}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </div>
          )}
        </section>
      </div>

      {res && (
        <>
          <section aria-labelledby="lb-h" className="space-y-3">
            <SectionTitle id="lb-h" aside={<Button size="sm" variant="outline" onClick={() => askCb(`Explain the eval result for ${skill.manifest.name}`)}><MessagesSquare aria-hidden="true" />Explain</Button>}>
              Leaderboard
            </SectionTitle>
            <p className="type-body text-muted-foreground">
              {fmtNum(res.n)} examples × {run!.repeats} repeats. Quality is the rubric score (0–100) with a 95% interval; the difference is paired against {modelName(res.defaultModel)} on the same examples. The judge agrees with {res.judge.humanLabels} human spot-check labels {Math.round(res.judge.agreement * 100)}% of the time (κ {res.judge.kappa}).
            </p>
            <Table>
              <TableCaption className="sr-only">Models ranked by quality with intervals, cost, latency and gate state</TableCaption>
              <TableHeader>
                <TableRow>
                  <TableHead scope="col">#</TableHead>
                  <TableHead scope="col">Model</TableHead>
                  <TableHead scope="col" className="text-right">Quality (95% CI)</TableHead>
                  <TableHead scope="col" className="text-right">vs default (95% CI)</TableHead>
                  <TableHead scope="col" className="text-right">Between repeats</TableHead>
                  <TableHead scope="col" className="text-right">Cost per run</TableHead>
                  <TableHead scope="col" className="text-right">Credits per run</TableHead>
                  <TableHead scope="col" className="text-right">Latency p50</TableHead>
                  <TableHead scope="col">Gate</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {[...res.models].sort((a, b) => b.quality.mean - a.quality.mean).map((m, i) => (
                  <TableRow key={m.model}>
                    <TableCell className="tabular-nums">{i + 1}</TableCell>
                    <TableHead scope="row">
                      {modelName(m.model)}
                      {m.model === res.defaultModel ? <span className="ml-1 type-caption font-normal text-muted-foreground">default</span> : null}
                    </TableHead>
                    <TableCell className="text-right tabular-nums">
                      {fmtQ(m.quality.mean)} <span className="text-muted-foreground">({m.quality.lo.toFixed(1)}–{m.quality.hi.toFixed(1)})</span>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{m.model === res.defaultModel ? "—" : `${signed(m.diff.mean)} (${m.diff.lo.toFixed(1)} to ${m.diff.hi.toFixed(1)})`}</TableCell>
                    <TableCell className="text-right tabular-nums">±{m.quality.repeatSd.toFixed(2)}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {fmtUsd(m.costPerRun, 4)} <span className="text-muted-foreground">({Math.round(m.costShare * 100)}%)</span>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{m.creditsPerRun.toFixed(2)}</TableCell>
                    <TableCell className="text-right tabular-nums">{(m.latencyP50 / 1000).toFixed(1)} s</TableCell>
                    <TableCell>
                      <GateBadge state={gateFor(ev, t.pack, skillId, m.model).state} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </section>

          <div className="grid gap-6 xl:grid-cols-2">
            <section aria-labelledby="fr-h" className="space-y-2 rounded-xl border border-border bg-card p-4">
              <h3 id="fr-h" className="type-heading">Cost versus quality</h3>
              <p id="fr-sum" className="type-caption text-muted-foreground">
                Error bars are 95% intervals. The line joins the Pareto frontier: {frontPts.map((p) => p.name).join(", ")}. No other model is both cheaper and better than a model on it.
              </p>
              <ChartContainer config={{ q: { label: "Quality", color: "var(--chart-1)" }, f: { label: "Pareto frontier", color: "var(--chart-2)" } } satisfies ChartConfig} className="aspect-auto h-64 w-full" role="img" aria-labelledby="fr-h" aria-describedby="fr-sum">
                <ScatterChart margin={{ top: 12, right: 16, bottom: 22, left: 0 }}>
                  <CartesianGrid strokeDasharray="2 4" />
                  <XAxis type="number" dataKey="x" domain={[0, 110]} unit="%" name="Cost" label={{ value: "Cost per run, % of default", position: "insideBottom", offset: -12, fill: "var(--foreground)", fontSize: 12 }} />
                  <YAxis type="number" dataKey="y" domain={["dataMin - 4", "dataMax + 2"]} name="Quality" width={44} tickFormatter={(v: number) => v.toFixed(0)} />
                  <ZAxis range={[70, 70]} />
                  <ChartTooltip content={<ChartTooltipContent hideIndicator labelKey="name" />} />
                  <Scatter name="Pareto frontier" data={frontPts} fill="var(--color-f)" line={{ stroke: "var(--color-f)", strokeWidth: 2 }} shape={() => <g />} isAnimationActive={false} />
                  <Scatter name="Models" data={pts} fill="var(--color-q)" isAnimationActive={false}>
                    <ErrorBar dataKey="err" direction="y" width={4} stroke="var(--foreground)" strokeOpacity={0.6} />
                  </Scatter>
                </ScatterChart>
              </ChartContainer>
              <ul className="flex flex-wrap gap-3 type-caption text-muted-foreground">
                {pts.map((p) => (
                  <li key={p.name}>
                    {p.name}: {p.y} at {p.x}%
                  </li>
                ))}
              </ul>
            </section>
            <section aria-labelledby="su-h" className="min-w-0 space-y-2 rounded-xl border border-border bg-card p-4">
              <h3 id="su-h" className="type-heading">Suites</h3>
              <Table>
                <TableCaption className="sr-only">Every suite for every model, with intervals and pass, warn or fail</TableCaption>
                <TableHeader>
                  <TableRow>
                    <TableHead scope="col">Suite</TableHead>
                    {res.models.map((m) => (
                      <TableHead key={m.model} scope="col" className="text-right">
                        {modelName(m.model)}
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {run!.suites.map((sid) => (
                    <TableRow key={sid}>
                      <TableHead scope="row" title={SUITES.find((s) => s.id === sid)?.what}>
                        {suiteLabel(sid)}
                      </TableHead>
                      {res.models.map((m) => {
                        const v = m.suites[sid];
                        if (!v) return <TableCell key={m.model}>—</TableCell>;
                        const interval = v.unit === "%" ? ` (${(v.lo * 100).toFixed(0)}–${(v.hi * 100).toFixed(0)})` : v.unit === "pts" && sid === "rubric" ? ` (${v.lo.toFixed(1)}–${v.hi.toFixed(1)})` : v.unit === "pts" ? ` (±0.6)` : "";
                        return (
                          <TableCell key={m.model} className="text-right tabular-nums">
                            <span className={v.state === "fail" ? "font-semibold text-blocked-ink" : v.state === "warn" ? "font-semibold text-watch-ink" : ""}>{v.display}</span>
                            <span className="text-muted-foreground">{interval}</span>
                            {v.state !== "pass" && <span className="sr-only"> {v.state}</span>}
                          </TableCell>
                        );
                      })}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </section>
          </div>

          <section aria-labelledby="dd-h" className="space-y-3">
            <SectionTitle
              id="dd-h"
              aside={
                <div className="flex items-center gap-2">
                  <Label htmlFor="cand" className="type-caption">Compare</Label>
                  <NativeSelect id="cand" value={cand} onChange={(e) => setCandidate(e.target.value)} size="sm">
                    {res.models.filter((m) => m.model !== res.defaultModel).map((m) => (
                      <NativeSelectOption key={m.model} value={m.model}>
                        {modelName(m.model)}
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                </div>
              }
            >
              Examples and failures
            </SectionTitle>
            <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
              <ol aria-label="Hardest examples for the selected model, side by side" className="space-y-2">
                {exs.map((x) => (
                  <li key={x.i} className="rounded-lg border border-border bg-card p-3">
                    <div className="font-mono type-caption text-muted-foreground">#{x.i + 1} · {x.input}</div>
                    <div className="mt-2 grid gap-2 md:grid-cols-2">
                      {x.outputs.map((o) => (
                        <div key={o.model} className="rounded-md bg-muted/60 p-2">
                          <div className="flex items-center justify-between type-caption font-medium">
                            <span>{modelName(o.model)}</span>
                            <span className={`num ${o.score < 80 ? "text-blocked-ink" : ""}`}>{o.score.toFixed(0)}</span>
                          </div>
                          <p className="type-body">{o.text}</p>
                        </div>
                      ))}
                    </div>
                  </li>
                ))}
              </ol>
              <div className="space-y-2 rounded-xl border border-border bg-card p-4">
                <h3 className="type-heading">Failure clusters · {modelName(cand)}</h3>
                {clusters.length === 0 ? (
                  <p className="type-body text-muted-foreground">No example scored under 80.</p>
                ) : (
                  <ul className="space-y-2">
                    {clusters.map((c) => (
                      <li key={c.label} className="type-body">
                        <div className="flex items-center justify-between gap-2">
                          <span>{c.label}</span>
                          <span className="num font-semibold">{c.count}</span>
                        </div>
                        <div role="img" aria-label={`${Math.round(c.share * 100)}% of failures`} className="mt-1 h-1.5 rounded-full bg-muted">
                          <div className="h-1.5 rounded-full bg-blocked" style={{ width: `${Math.round(c.share * 100)}%` }} />
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </section>
        </>
      )}
    </div>
  );
}

function RubricEditor({ skillId }: { skillId: string }) {
  const { t, act, who } = usePlatform();
  const saved = t.platform.evals.rubrics[skillId] ?? [];
  const [rows, setRows] = useState<RubricCriterion[] | null>(null);
  const cur = rows ?? saved;
  const total = cur.reduce((s, c) => s + Math.max(0, c.weight), 0);
  return (
    <details className="rounded-lg border border-border p-3">
      <summary className="cursor-pointer type-body font-medium">Rubric ({cur.length} criteria)</summary>
      <form
        className="mt-3 space-y-2"
        onSubmit={(e) => {
          e.preventDefault();
          const r = act((s) => setRubric(s, skillId, cur, who));
          if (r?.ok) setRows(null);
        }}
      >
        {cur.map((c, i) => (
          <div key={c.id} className="grid grid-cols-[minmax(0,1fr)_88px_auto] items-end gap-2">
            <div className="space-y-1">
              <Label htmlFor={`rb-l-${c.id}`} className="type-caption">Criterion {i + 1}</Label>
              <Input id={`rb-l-${c.id}`} value={c.label} onChange={(e) => setRows(cur.map((x) => (x.id === c.id ? { ...x, label: e.target.value } : x)))} />
            </div>
            <div className="space-y-1">
              <Label htmlFor={`rb-w-${c.id}`} className="type-caption">Weight</Label>
              <Input id={`rb-w-${c.id}`} type="number" min={0} max={100} value={c.weight} onChange={(e) => setRows(cur.map((x) => (x.id === c.id ? { ...x, weight: Number(e.target.value) } : x)))} />
            </div>
            <Button type="button" size="icon-sm" variant="ghost" aria-label={`Remove ${c.label}`} onClick={() => setRows(cur.filter((x) => x.id !== c.id))}>
              <Trash2 aria-hidden="true" />
            </Button>
          </div>
        ))}
        <p className="type-caption text-muted-foreground">Weights are normalised ({total} in total). Saving applies to the next run; earlier runs keep their rubric.</p>
        <div className="flex gap-2">
          <Button type="button" size="sm" variant="outline" onClick={() => setRows([...cur, { id: `c${Date.now().toString(36)}`, label: "New criterion", weight: 10 }])}>
            <Plus aria-hidden="true" />
            Add criterion
          </Button>
          <Button type="submit" size="sm" disabled={!rows}>
            Save rubric
          </Button>
        </div>
      </form>
    </details>
  );
}

// ------------------------------------------------------------------ model right-sizing

export function RightSizingPanel({ skillId }: { skillId: string }) {
  const { t, act, who, setUi } = usePlatform();
  const ev = t.platform.evals;
  const skill = ev.skills.find((s) => s.id === skillId);
  const rec = useMemo(() => recommend(ev, t.pack, skillId), [ev, t.pack, skillId]);
  const [reinvest, setReinvest] = useState(40);
  const target = rec.switch ? rec.model : (rec.result?.models.filter((m) => m.model !== rec.current).sort((a, b) => b.quality.mean - a.quality.mean)[0]?.model ?? rec.current);
  const imp = useMemo(() => impactOf(t, ev, skillId, target, reinvest / 100), [t, ev, skillId, target, reinvest]);
  if (!skill) return null;
  const res = rec.result;
  const gate = gateFor(ev, t.pack, skillId, target);
  const experiment = () => {
    const r = act((s) => createModelExperiment(s, skillId, target, who));
    if (r?.ok && r.id) setUi({ wbTab: "experiments", wbExperiment: r.id });
  };
  return (
    <div className="space-y-6">
      <section aria-labelledby="rs-h" className="space-y-3">
        <SectionTitle id="rs-h" aside={`Margin ${ev.margin} points · ${latestRun(ev, skillId) ? `run ${fmtDate(latestRun(ev, skillId)!.at)}` : "no run"}`}>
          Model right-sizing · {skill.manifest.name}
        </SectionTitle>
        <div role="status" className={`rounded-xl border p-4 ${rec.switch ? "border-healthy bg-healthy-soft text-healthy-ink" : "border-watch bg-watch-soft text-watch-ink"}`}>
          <div className="type-caption font-semibold uppercase tracking-wide">{rec.switch ? "Recommendation" : "Keep the default"}</div>
          <p className="type-body">{rec.text}</p>
        </div>
        {res && (
          <Table>
            <TableCaption className="sr-only">Models with quality interval, cost per run, latency and credits per run</TableCaption>
            <TableHeader>
              <TableRow>
                <TableHead scope="col">Model</TableHead>
                <TableHead scope="col" className="text-right">Quality (95% CI)</TableHead>
                <TableHead scope="col" className="text-right">Cost per run</TableHead>
                <TableHead scope="col" className="text-right">Latency p50</TableHead>
                <TableHead scope="col" className="text-right">Credits per run</TableHead>
                <TableHead scope="col">Gate</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {[...res.models].sort((a, b) => b.costShare - a.costShare).map((m) => (
                <TableRow key={m.model} className={m.model === rec.model && rec.switch ? "bg-healthy-soft/50" : undefined}>
                  <TableHead scope="row">
                    {modelName(m.model)}
                    {m.model === res.defaultModel ? <span className="ml-1 type-caption font-normal text-muted-foreground">default</span> : m.model === rec.model && rec.switch ? <span className="ml-1 type-caption font-semibold text-healthy-ink">recommended</span> : null}
                  </TableHead>
                  <TableCell className="text-right tabular-nums">
                    {fmtQ(m.quality.mean)} ({m.quality.lo.toFixed(1)}–{m.quality.hi.toFixed(1)})
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {fmtUsd(m.costPerRun, 4)} · {Math.round(m.costShare * 100)}%
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{(m.latencyP50 / 1000).toFixed(1)} s</TableCell>
                  <TableCell className="text-right tabular-nums">{m.creditsPerRun.toFixed(2)}</TableCell>
                  <TableCell>
                    <GateBadge state={gateFor(ev, t.pack, skillId, m.model).state} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </section>
      {target !== rec.current && (
        <section aria-labelledby="imp-h" className="space-y-4 rounded-xl border border-border bg-card p-5">
          <SectionTitle id="imp-h" as="h3" aside={`${imp.cohort.label}: ${fmtNum(imp.cohort.size)} workspaces, ${fmtNum(imp.runs)} runs a month`}>
            Impact of {modelName(target)} for the cohort that burns credits fastest
          </SectionTitle>
          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-3">
              <Label htmlFor="reinvest">Scenario: share of the saved credits users spend on more runs</Label>
              <span className="num type-body font-semibold">{reinvest}%</span>
            </div>
            <Range id="reinvest" min={0} max={100} step={5} value={reinvest} onValueChange={(x) => setReinvest(x)} aria-label="Share of saved credits spent on more runs" />
            <p className="type-caption text-muted-foreground">0%: users pocket the savings, so revenue per task falls and fewer run out. 100%: they run more, so revenue holds and the gain is margin. Retention assumes workspaces that run out mid-month churn 12 points more often.</p>
          </div>
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <Stat label="Credits saved per run" value={imp.creditsSavedPerRun.toFixed(2)} sub={`${imp.creditsBefore.toFixed(2)} → ${imp.creditsAfter.toFixed(2)}`} />
            <Stat label="Spend per workspace" value={fmtUsd(imp.spendPerWorkspace.after, 0)} sub={`was ${fmtUsd(imp.spendPerWorkspace.before, 0)} a month`} />
            <Stat label="Margin per credit" value={fmtUsd(imp.marginPerCredit.after, 4)} sub={`was ${fmtUsd(imp.marginPerCredit.before, 4)}`} />
            <Stat label="Run out mid-month" value={`${Math.round(imp.exhaustion.after * 100)}%`} sub={`was ${Math.round(imp.exhaustion.before * 100)}%`} />
          </div>
          <Table>
            <TableCaption className="sr-only">Net effect this month and over twelve months</TableCaption>
            <TableHeader>
              <TableRow>
                <TableHead scope="col">Net effect</TableHead>
                <TableHead scope="col" className="text-right">This month</TableHead>
                <TableHead scope="col" className="text-right">Over 12 months</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow>
                <TableHead scope="row">Usage revenue (lower revenue per task)</TableHead>
                <TableCell className="text-right tabular-nums">{fmtUsd(imp.revenue.change, 0)}</TableCell>
                <TableCell className="text-right tabular-nums">{fmtUsd(imp.revenue.change * 12, 0)}</TableCell>
              </TableRow>
              <TableRow>
                <TableHead scope="row">Retained accounts</TableHead>
                <TableCell className="text-right tabular-nums">{imp.retainedAccounts.toFixed(1)} · {fmtUsd(imp.retainedRevenue, 0)}</TableCell>
                <TableCell className="text-right tabular-nums">{fmtUsd(imp.year.revenue - imp.revenue.change * 12, 0)}</TableCell>
              </TableRow>
              <TableRow>
                <TableHead scope="row">Net revenue</TableHead>
                <TableCell className="text-right font-semibold tabular-nums">{fmtUsd(imp.netRevenue, 0)}</TableCell>
                <TableCell className="text-right font-semibold tabular-nums">{fmtUsd(imp.year.revenue, 0)}</TableCell>
              </TableRow>
              <TableRow>
                <TableHead scope="row">Net gross profit (after provider cost)</TableHead>
                <TableCell className="text-right font-semibold tabular-nums">{fmtUsd(imp.netGrossProfit, 0)}</TableCell>
                <TableCell className="text-right font-semibold tabular-nums">{fmtUsd(imp.year.grossProfit, 0)}</TableCell>
              </TableRow>
            </TableBody>
          </Table>
          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={experiment}>
              <FlaskConical aria-hidden="true" />
              Create experiment
            </Button>
            <Button variant="outline" onClick={() => act((s) => setSkillDefault(s, skillId, target, who))}>
              Switch the default for everyone
            </Button>
            <GateBadge state={gate.state} />
          </div>
          <p className="type-caption text-muted-foreground">The experiment switches the default for {imp.cohort.label.toLowerCase()} only, with user-reported quality and rerun rate as guardrails, and a canary eval every simulated day.</p>
        </section>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ quality gate

export function GatePanel() {
  const { t, act, who } = usePlatform();
  const ev = t.platform.evals;
  const live = ev.skills.filter((s) => s.status === "live");
  const touching = t.growth.lab.filter((e) => e.skill && !e.sandbox);
  const [form, setForm] = useState({ skillId: "find-work-email", model: "balanced", experimentId: "", reason: "" });
  const [review, setReview] = useState<string | null>(null);
  const pending = ev.overrides.filter((o) => o.status === "pending");
  const ro = ev.overrides.find((o) => o.id === review);
  return (
    <div className="space-y-6">
      <section aria-labelledby="gate-h" className="space-y-3">
        <SectionTitle id="gate-h" aside="Pass, warn or fail for every allowed model">
          Quality gate
        </SectionTitle>
        <p className="type-body text-muted-foreground">Any experiment or default change that touches a skill needs a passing eval first. Fail blocks the launch unless an override with a reason is approved; overrides are audited. After launch, canary evals run every simulated day and trip the stop-loss if quality drops.</p>
        <Table>
          <TableCaption className="sr-only">Gate state per skill and model</TableCaption>
          <TableHeader>
            <TableRow>
              <TableHead scope="col">Skill</TableHead>
              {["frontier", "balanced", "swift", "compact"].map((m) => (
                <TableHead key={m} scope="col">{modelName(m)}</TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {live.map((s) => (
              <TableRow key={s.id}>
                <TableHead scope="row">{s.manifest.name}</TableHead>
                {["frontier", "balanced", "swift", "compact"].map((m) => {
                  if (!s.manifest.allowedModels.includes(m)) return <TableCell key={m}>Not allowed</TableCell>;
                  const g = gateFor(ev, t.pack, s.id, m);
                  return (
                    <TableCell key={m} className="whitespace-normal align-top">
                      <GateBadge state={g.state} />
                      {g.state !== "pass" && <p className="mt-1 max-w-56 type-caption text-muted-foreground">{g.reasons.find((r) => !r.startsWith("Within")) ?? g.reasons[0]}</p>}
                    </TableCell>
                  );
                })}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </section>
      <div className="grid gap-6 xl:grid-cols-2">
        <section aria-labelledby="touch-h" className="space-y-3 rounded-xl border border-border bg-card p-4">
          <h3 id="touch-h" className="type-heading">Experiments that touch a skill</h3>
          {touching.length === 0 ? (
            <p className="type-body text-muted-foreground">None yet. Create one from Model right-sizing.</p>
          ) : (
            <ul className="space-y-3">
              {touching.map((e) => {
                const g = gateFor(ev, t.pack, e.skill!.id, e.skill!.to);
                const can = ev.canary[e.id] ?? [];
                return (
                  <li key={e.id} className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="type-body font-medium">{e.name}</span>
                      <ToneBadge tone="neutral">{e.status}</ToneBadge>
                      <GateBadge state={g.state} />
                    </div>
                    {e.pausedReason && <p className="type-caption text-blocked-ink">{e.pausedReason}</p>}
                    {can.length > 0 && (
                      <p className="type-caption text-muted-foreground">
                        Canary: {can.slice(-5).map((c) => c.quality.toFixed(1)).join(" · ")}
                      </p>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </section>
        <section aria-labelledby="ovr-h" className="space-y-3 rounded-xl border border-border bg-card p-4">
          <h3 id="ovr-h" className="type-heading">Overrides</h3>
          <form
            className="grid gap-3 sm:grid-cols-2"
            onSubmit={(e) => {
              e.preventDefault();
              const r = act((s) => requestOverride(s, { skillId: form.skillId, model: form.model, experimentId: form.experimentId || null, reason: form.reason, by: who }));
              if (r?.ok) setForm({ ...form, reason: "" });
            }}
          >
            <div className="space-y-1.5">
              <Label htmlFor="ovr-skill">Skill</Label>
              <NativeSelect id="ovr-skill" value={form.skillId} onChange={(e) => setForm({ ...form, skillId: e.target.value })}>
                {live.map((s) => (
                  <NativeSelectOption key={s.id} value={s.id}>
                    {s.manifest.name}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ovr-model">Model</Label>
              <NativeSelect id="ovr-model" value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })}>
                {["balanced", "swift", "compact"].map((m) => (
                  <NativeSelectOption key={m} value={m}>
                    {modelName(m)}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="ovr-exp">Experiment (optional)</Label>
              <NativeSelect id="ovr-exp" value={form.experimentId} onChange={(e) => setForm({ ...form, experimentId: e.target.value })}>
                <NativeSelectOption value="">Any change for this skill and model</NativeSelectOption>
                {touching.map((e) => (
                  <NativeSelectOption key={e.id} value={e.id}>
                    {e.name}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="ovr-reason">Reason (goes in the audit log)</Label>
              <Textarea id="ovr-reason" rows={2} value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} />
            </div>
            <Button type="submit" variant="outline" className="sm:col-span-2" disabled={form.reason.trim().length < 10}>
              <ShieldAlert aria-hidden="true" />
              Request override
            </Button>
          </form>
          {ev.overrides.length > 0 && (
            <ul className="divide-y divide-border rounded-lg border border-border">
              {ev.overrides.map((o) => (
                <li key={o.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 type-caption">
                  <span>
                    {ev.skills.find((s) => s.id === o.skillId)?.manifest.name} on {modelName(o.model)} · {o.requestedBy}: “{o.reason}”
                    {o.decidedBy ? ` · ${o.status} by ${o.decidedBy}` : ""}
                  </span>
                  {o.status === "pending" ? (
                    <Button size="xs" onClick={() => setReview(o.id)}>
                      Review
                    </Button>
                  ) : (
                    <ToneBadge tone={o.status === "approved" ? "watch" : "neutral"}>{o.status}</ToneBadge>
                  )}
                </li>
              ))}
            </ul>
          )}
          {pending.length > 0 && <p className="type-caption text-muted-foreground">{pending.length} waiting for an approver.</p>}
        </section>
      </div>
      {ro && (
        <ApprovalSheet
          open={!!ro}
          onOpenChange={(o) => !o && setReview(null)}
          title="Approve a quality gate override?"
          description={`${ro.requestedBy} asked to use ${modelName(ro.model)} for ${ev.skills.find((s) => s.id === ro.skillId)?.manifest.name} despite the gate.`}
          preview={<p className="type-body">Reason: “{ro.reason}”. Gate now: {gateFor(ev, t.pack, ro.skillId, ro.model).reasons[0]}</p>}
          diff={[{ path: "gate.override", before: "blocked", after: "allowed, audited" }]}
          risk={{ level: "high", reasons: ["Customers may see lower quality than the eval accepts.", "Canary evals still run and can stop the experiment."] }}
          auditId={ro.id}
          onApprove={() => {
            act((s) => decideOverride(s, ro.id, true, who));
            setReview(null);
          }}
          onReject={() => {
            act((s) => decideOverride(s, ro.id, false, who));
            setReview(null);
          }}
          approveLabel="Approve override"
        />
      )}
    </div>
  );
}

// ------------------------------------------------------------------ regression watch

const driftConfig = { a: { label: "In use", color: "var(--chart-1)" }, b: { label: "Recommended", color: "var(--chart-2)" } } satisfies ChartConfig;

export function RegressionPanel({ skillId }: { skillId: string }) {
  const { t, act, run, askCb } = usePlatform();
  const ev = t.platform.evals;
  const skill = ev.skills.find((s) => s.id === skillId);
  const rec = useMemo(() => recommend(ev, t.pack, skillId), [ev, t.pack, skillId]);
  const [model, setModel] = useState("balanced");
  const [drift, setDrift] = useState(-4);
  if (!skill) return null;
  const a = driftSeries(ev, skillId, skill.inUse, t.clock);
  const other = rec.switch ? rec.model : skill.manifest.allowedModels.find((m) => m !== skill.inUse) ?? skill.inUse;
  const b = driftSeries(ev, skillId, other, t.clock);
  const data = a.map((p, i) => ({ x: p.x.slice(5), a: p.y, b: b[i]?.y }));
  const changes = [...a, ...b].filter((p) => p.change).map((p) => p.x.slice(5));
  return (
    <div className="space-y-6">
      <section aria-labelledby="drift-h" className="space-y-3 rounded-xl border border-border bg-card p-4">
        <SectionTitle
          id="drift-h"
          as="h3"
          aside={
            <div className="flex items-center gap-2">
              <Label htmlFor="sched" className="type-caption">Re-eval</Label>
              <NativeSelect id="sched" size="sm" value={ev.schedule[skillId] ?? "on-change"} onChange={(e) => run((s) => setSchedule(s, skillId, e.target.value as "daily" | "weekly" | "on-change"), "Schedule saved.")}>
                <NativeSelectOption value="on-change">When a provider changes a model</NativeSelectOption>
                <NativeSelectOption value="daily">Daily</NativeSelectOption>
                <NativeSelectOption value="weekly">Weekly</NativeSelectOption>
              </NativeSelect>
            </div>
          }
        >
          Drift · {skill.manifest.name}
        </SectionTitle>
        <p id="drift-sum" className="type-caption text-muted-foreground">
          Daily scheduled scores for {modelName(skill.inUse)} (in use) and {modelName(other)} over 30 days. Dashed lines mark provider changes{changes.length ? `: ${changes.join(", ")}` : ""}.
        </p>
        <ChartContainer config={driftConfig} className="aspect-auto h-56 w-full" role="img" aria-labelledby="drift-h" aria-describedby="drift-sum">
          <LineChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
            <CartesianGrid strokeDasharray="2 4" />
            <XAxis dataKey="x" interval={6} />
            <YAxis domain={["dataMin - 2", "dataMax + 1"]} width={40} tickFormatter={(v: number) => v.toFixed(0)} />
            <ChartTooltip content={<ChartTooltipContent />} />
            {changes.map((c) => (
              <ReferenceLine key={c} x={c} stroke="var(--foreground)" strokeDasharray="4 4" strokeOpacity={0.6} />
            ))}
            <Line dataKey="a" name={modelName(skill.inUse)} stroke="var(--color-a)" dot={false} strokeWidth={2} isAnimationActive={false} />
            <Line dataKey="b" name={modelName(other)} stroke="var(--color-b)" dot={false} strokeWidth={2} isAnimationActive={false} />
          </LineChart>
        </ChartContainer>
      </section>
      <div className="grid gap-6 xl:grid-cols-2">
        <section aria-labelledby="al-h" className="space-y-3 rounded-xl border border-border bg-card p-4">
          <h3 id="al-h" className="type-heading">Alerts</h3>
          {ev.alerts.length === 0 ? (
            <p className="type-body text-muted-foreground">No alerts.</p>
          ) : (
            <ul className="space-y-2">
              {ev.alerts.slice(0, 8).map((al) => (
                <li key={al.id} className="flex flex-wrap items-start justify-between gap-2 rounded-lg border border-border p-3">
                  <div className="min-w-0 flex-1">
                    <ToneBadge tone={al.severity === "blocked" ? "blocked" : "watch"}>{fmtDate(al.at)}</ToneBadge>
                    <p className="mt-1 type-body">{al.text}</p>
                  </div>
                  <Button
                    size="xs"
                    variant={al.routed ? "ghost" : "outline"}
                    onClick={() => {
                      run((s) => routeAlert(s, al.id), "Sent to Ask CB.", true);
                      askCb(`Explain the regression alert for ${ev.skills.find((s) => s.id === al.skillId)?.manifest.name ?? al.skillId}`);
                    }}
                  >
                    <Bot aria-hidden="true" />
                    {al.routed ? "Open in Ask CB" : "Route to Ask CB"}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section aria-labelledby="pc-h" className="space-y-3 rounded-xl border border-border bg-card p-4">
          <h3 id="pc-h" className="type-heading">Provider changes</h3>
          <ul className="space-y-1 type-caption">
            {ev.providerChanges.map((c) => (
              <li key={c.id}>
                {fmtDate(c.at)} · {modelName(c.model)} · {c.note}
              </li>
            ))}
          </ul>
          <form
            className="grid gap-3 border-t border-border pt-3 sm:grid-cols-2"
            onSubmit={(e) => {
              e.preventDefault();
              act((s) => providerChange(s, model, drift, `Provider updated ${modelName(model)} (drill)`));
            }}
          >
            <div className="space-y-1.5">
              <Label htmlFor="pc-model">Model</Label>
              <NativeSelect id="pc-model" value={model} onChange={(e) => setModel(e.target.value)}>
                {["frontier", "balanced", "swift", "compact"].map((m) => (
                  <NativeSelectOption key={m} value={m}>
                    {modelName(m)}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </div>
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label htmlFor="pc-drift">Quality change</Label>
                <span className="num type-caption">{signed(drift)} pts</span>
              </div>
              <Range id="pc-drift" min={-8} max={2} step={0.5} value={drift} onValueChange={(x) => setDrift(x)} aria-label="Quality change in points" />
            </div>
            <Button type="submit" variant="outline" className="sm:col-span-2">
              Simulate a provider change
            </Button>
            <p className="type-caption text-muted-foreground sm:col-span-2">Then move the Time machine a day: scheduled re-evals run, an alert lands here, and any running experiment on that model checks its canary.</p>
          </form>
        </section>
      </div>
    </div>
  );
}
