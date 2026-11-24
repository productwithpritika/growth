// Brain → Population and Help chats: the 90-day simulator's config, output, persisted cohort
// tables, model choice with evals, and the synthetic help-chat transcripts.
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { Play, RotateCcw, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { Skeleton } from "@/components/ui/skeleton";
import { SectionTitle, Stat } from "@/ui/primitives";
import { ToneBadge } from "@/ui/tone";
import { useCockpit } from "@/lib/cockpit-store";
import { fmtDate, fmtNum, fmtPct, fmtUsd } from "@/core/format";
import { logTenantEvent, planOf, primaryMeter, type TenantState } from "@/core";
import type { SimConfig } from "@/tenants/schema";
import { regionById } from "@/tenants/regions";
import { simConfigFor, simulate90, simulateCached } from "@/sim/usage90";
import { CHAT_INTENTS, COHORT_DIMENSIONS, type ChatIntent, type CohortDimension, type PopulationRecord, type SimOutput } from "@/sim/usage90-types";
import { cn } from "@/lib/utils";

type Run = (fn: (s: TenantState) => TenantState, ok: string) => void;

export function recordOf(o: SimOutput): PopulationRecord {
  return { config: o.config, anchor: o.anchor, hash: o.hash, ranAt: new Date().toISOString(), totals: o.totals, cohorts: o.cohorts };
}

/** The tenant's simulated population: from the persisted run when there is one, else a first run that is then saved. */
export function usePopulation(t: TenantState): SimOutput | null {
  const apply = useCockpit((s) => s.apply);
  const rec = t.population;
  const pack = t.pack;
  const key = rec ? `${pack.id}|${rec.hash}` : `${pack.id}|none`;
  const [out, setOut] = useState<{ key: string; o: SimOutput } | null>(null);
  useEffect(() => {
    let live = true;
    const id = window.setTimeout(() => {
      const o = simulateCached(pack, rec?.config ?? simConfigFor(pack), rec?.anchor ?? t.clock);
      if (!live) return;
      setOut({ key, o });
      if (!rec) apply((s) => logTenantEvent({ ...s, population: recordOf(o) }, "sim.population_run", `${fmtNum(o.workspaces.length)} workspaces · ${o.config.days} days · seed ${o.config.seed} · ${o.hash}`));
    }, 30);
    return () => {
      live = false;
      window.clearTimeout(id);
    };
  }, [key, pack, rec, t.clock, apply]);
  return out && out.key === key ? out.o : null;
}

const SHARES: { key: keyof SimConfig["behaviours"]; label: string }[] = [
  { key: "churnAfter3Months", label: "Paid workspaces that churn after about 3 months" },
  { key: "addTopUps", label: "Paid workspaces that buy top-ups" },
  { key: "switchModels", label: "Switch to a cheaper model" },
  { key: "stayOnDefault", label: "Stay on the default (most expensive) model" },
  { key: "freeGoQuiet", label: "Free workspaces that go quiet after a few days" },
  { key: "freeNeverRun", label: `Free workspaces that never run anything` },
];

const PALETTE = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)", "var(--chart-5)"];

export function PopulationTab({ t, run }: { t: TenantState; run: Run }) {
  const pack = t.pack;
  const out = usePopulation(t);
  const rec = t.population;
  const cfg = rec?.config ?? simConfigFor(pack);
  const [busy, setBusy] = useState<string | null>(null);
  const [verify, setVerify] = useState<{ ok: boolean; hash: string; ms: number } | null>(null);
  const [dim, setDim] = useState<CohortDimension>("signupMonth");
  const prim = primaryMeter(pack);

  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const num = (k: string, d: number) => (Number.isFinite(Number(f.get(k))) && String(f.get(k)).trim() !== "" ? Number(f.get(k)) : d);
    const behaviours = { ...cfg.behaviours };
    for (const s of SHARES) behaviours[s.key] = Math.min(1, Math.max(0, num(s.key, behaviours[s.key] * 100) / 100));
    const next: SimConfig = { ...cfg, seed: Math.round(num("seed", cfg.seed)), workspaces: Math.min(5000, Math.max(100, Math.round(num("workspaces", cfg.workspaces)))), behaviours };
    setBusy(`Simulating ${fmtNum(next.workspaces)} workspaces over ${next.days} days…`);
    setVerify(null);
    window.setTimeout(() => {
      const o = simulateCached(pack, next, t.clock);
      run((s) => logTenantEvent({ ...s, population: recordOf(o) }, "sim.population_run", `${fmtNum(o.workspaces.length)} workspaces · ${o.config.days} days · seed ${o.config.seed} · ${o.hash}`), `Simulated ${fmtNum(o.workspaces.length)} workspaces. Cohort tables saved.`);
      setBusy(null);
    }, 30);
  };

  const rerun = () => {
    if (!rec) return;
    setBusy("Running the same seed again…");
    window.setTimeout(() => {
      const o = simulate90(pack, rec.config, rec.anchor);
      setVerify({ ok: o.hash === rec.hash, hash: o.hash, ms: o.ms });
      setBusy(null);
    }, 30);
  };

  const enrich = cfg.enrichments;
  const chartConfig = useMemo(() => Object.fromEntries(enrich.map((e, i) => [e.id, { label: e.label, color: PALETTE[i % PALETTE.length] }])) satisfies ChartConfig, [enrich]);
  const chartData = useMemo(() => (out ? out.daily.map((d) => ({ label: fmtDate(d.date), ...Object.fromEntries(enrich.map((e) => [e.id, Math.round(d.byEnrichment[e.id] ?? 0)])) })) : []), [out, enrich]);

  return (
    <div className="space-y-6">
      <section aria-labelledby="pop-title" className="space-y-3">
        <SectionTitle id="pop-title" aside={out ? `${out.windowStart} → ${out.anchor} · seed ${out.config.seed} · hash ${out.hash}` : undefined}>
          90-day population
        </SectionTitle>
        <p className="type-body text-muted-foreground">
          {fmtNum(cfg.workspaces)} {pack.company} workspaces from a fixed seed: what they run ({enrich.map((e) => e.label.toLowerCase()).join(", ")}), what comes back, which model they use, which plan they're on, and when they top up, go quiet or churn. Workspaces that signed up before the window carry their history from signup, so cohorts have a past.
        </p>
        {!out ? (
          <Busy label={busy ?? `Simulating ${fmtNum(cfg.workspaces)} workspaces over ${cfg.days} days…`} />
        ) : (
          <>
            <div className="grid grid-cols-2 gap-4 rounded-xl border border-border bg-card p-4 sm:grid-cols-4 xl:grid-cols-8">
              <Stat label="Workspaces" value={fmtNum(out.totals.workspaces)} sub={`${fmtNum(out.totals.paid)} paid`} />
              <Stat label="Active now" value={fmtNum(out.totals.activeNow)} sub="ran in the last 14 days" />
              <Stat label="Runs" value={fmtNum(out.totals.runs)} sub={`${fmtNum(out.totals.blocked)} blocked`} />
              <Stat label={prim.label} value={prim.valueType === "currency" ? fmtUsd(out.totals.credits, 0) : fmtNum(out.totals.credits)} sub="used in 90 days" />
              <Stat label="Revenue" value={fmtUsd(out.totals.subsRevenue + out.totals.topUpRevenue, 0)} sub={`${fmtUsd(out.totals.topUpRevenue, 0)} from top-ups`} />
              <Stat label="Provider cost" value={fmtUsd(out.totals.providerCost, 0)} sub={`${fmtPct(1 - out.totals.providerCost / Math.max(1, out.totals.subsRevenue + out.totals.topUpRevenue))} margin`} />
              <Stat label="On default model" value={fmtPct(out.totals.defaultModelShare)} sub="of model-choice runs" />
              <Stat label="Churned" value={fmtNum(out.totals.churnedInWindow)} sub={`${fmtNum(out.totals.quiet)} quiet · ${fmtNum(out.totals.neverRan)} never ran`} />
            </div>

            <div className="rounded-xl border border-border bg-card p-4">
              <h3 id="pop-chart-title" className="type-body font-semibold">
                {prim.label} used per day, by kind of work
              </h3>
              <p id="pop-chart-sum" className="type-caption text-muted-foreground">
                Weekday peaks, weekend dips. {enrich.map((e) => `${e.label} ${fmtPct(out.daily.reduce((s, d) => s + (d.byEnrichment[e.id] ?? 0), 0) / Math.max(1, out.totals.credits))}`).join(" · ")}.
              </p>
              <ChartContainer config={chartConfig} className="mt-2 aspect-auto h-[200px] w-full" role="img" aria-labelledby="pop-chart-title" aria-describedby="pop-chart-sum">
                <BarChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid vertical={false} />
                  <XAxis dataKey="label" tickLine={false} axisLine={false} interval={13} tickMargin={6} />
                  <YAxis width={56} tickLine={false} axisLine={false} tickFormatter={(v: number) => fmtNum(v)} />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  {enrich.map((e) => (
                    <Bar key={e.id} dataKey={e.id} stackId="a" fill={`var(--color-${e.id})`} isAnimationActive={false} />
                  ))}
                </BarChart>
              </ChartContainer>
              <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 type-caption text-muted-foreground">
                {enrich.map((e, i) => (
                  <li key={e.id} className="inline-flex items-center gap-1.5">
                    <span aria-hidden="true" className="size-2.5 rounded-sm" style={{ background: PALETTE[i % PALETTE.length] }} />
                    {e.label}
                  </li>
                ))}
              </ul>
            </div>

            <div className="grid gap-6 xl:grid-cols-2">
              <Outcomes out={out} />
              <ModelChoice out={out} t={t} />
            </div>

            <section aria-labelledby="cohort-title" className="space-y-3">
              <div className="flex flex-wrap items-end gap-3">
                <SectionTitle id="cohort-title" aside={rec ? `Saved ${fmtDate(rec.ranAt)} with the run` : undefined}>
                  Cohort tables
                </SectionTitle>
                <div className="ml-auto flex items-center gap-2">
                  <Label htmlFor="cohort-dim" className="type-caption text-muted-foreground">
                    By
                  </Label>
                  <NativeSelect id="cohort-dim" size="sm" value={dim} onChange={(e) => setDim(e.target.value as CohortDimension)}>
                    {COHORT_DIMENSIONS.map((d) => (
                      <NativeSelectOption key={d.id} value={d.id}>
                        {d.label}
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                </div>
              </div>
              <CohortTable t={t} rows={(rec?.cohorts ?? out.cohorts)[dim]} dim={dim} />
            </section>
          </>
        )}
      </section>

      <section aria-labelledby="pop-config-title" className="space-y-3">
        <SectionTitle id="pop-config-title" aside="Each share is a probability per workspace">
          Behaviours
        </SectionTitle>
        <form key={rec?.hash ?? "none"} onSubmit={submit} className="space-y-4 rounded-xl border border-border bg-card p-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="space-y-1.5">
              <Label htmlFor="sim-seed">Seed</Label>
              <Input id="sim-seed" name="seed" type="number" step={1} defaultValue={cfg.seed} className="h-8" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="sim-ws">Workspaces</Label>
              <Input id="sim-ws" name="workspaces" type="number" min={100} max={5000} step={100} defaultValue={cfg.workspaces} className="h-8" />
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {SHARES.map((s) => (
              <div key={s.key} className="space-y-1.5">
                <Label htmlFor={`sim-${s.key}`}>{s.label} (%)</Label>
                <Input id={`sim-${s.key}`} name={s.key} type="number" min={0} max={100} step={1} defaultValue={Math.round(cfg.behaviours[s.key] * 100)} className="h-8" />
              </div>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button type="submit" size="sm" disabled={!!busy}>
              <Play aria-hidden="true" />
              Run and save
            </Button>
            <Button type="button" size="sm" variant="outline" disabled={!!busy || !rec} onClick={rerun}>
              <RotateCcw aria-hidden="true" />
              Re-run the same seed
            </Button>
            {busy && out && (
              <span role="status" className="type-caption text-muted-foreground">
                {busy}
              </span>
            )}
          </div>
          {verify && (
            <p role="status" className={cn("flex items-center gap-1.5 type-caption", verify.ok ? "text-healthy-ink" : "text-blocked-ink")}>
              <ShieldCheck aria-hidden="true" className="size-3.5" />
              {verify.ok ? `Identical: the fresh run's hash ${verify.hash} matches the saved one (${verify.ms} ms).` : `Different: fresh hash ${verify.hash}, saved ${rec?.hash}.`}
            </p>
          )}
          <p className="type-caption text-muted-foreground">Enrichment mix, outcome mix, models, regions and sources come from the Tenant Pack (demo.sim); a pack without that section gets a mix derived from its rate card.</p>
        </form>
      </section>
    </div>
  );
}

function Outcomes({ out }: { out: SimOutput }) {
  const totals = new Map<string, number>();
  for (const d of out.daily) for (const [k, v] of Object.entries(d.outcomes)) totals.set(k, (totals.get(k) ?? 0) + v);
  const all = [...totals.values()].reduce((a, b) => a + b, 0) || 1;
  return (
    <section aria-labelledby="outcomes-title" className="min-w-0 space-y-3 rounded-xl border border-border bg-card p-4">
      <SectionTitle id="outcomes-title" as="h3" aside={`${fmtNum(all)} rows`}>
        Outcomes
      </SectionTitle>
      <ul className="space-y-2">
        {out.config.outcomes.map((o) => {
          const v = totals.get(o.id) ?? 0;
          return (
            <li key={o.id} className="space-y-1">
              <div className="flex justify-between gap-2 type-body">
                <span>
                  {o.label} {o.charged ? <span className="type-caption text-muted-foreground">· charged</span> : <span className="type-caption text-muted-foreground">· free</span>}
                </span>
                <span className="num">
                  {fmtNum(v)} · {fmtPct(v / all)}
                </span>
              </div>
              <div aria-hidden="true" className="h-1.5 overflow-hidden rounded-full bg-muted">
                <div className={cn("h-full rounded-full", o.charged ? "bg-info" : "bg-muted-foreground/50")} style={{ width: `${(v / all) * 100}%` }} />
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function ModelChoice({ out, t }: { out: SimOutput; t: TenantState }) {
  const pack = t.pack;
  const name = (id: string) => pack.models.find((m) => m.id === id)?.name ?? id;
  const enrichLabel = (id: string) => out.config.enrichments.find((e) => e.id === id)?.label ?? id;
  return (
    <section aria-labelledby="models-title" className="min-w-0 space-y-3 rounded-xl border border-border bg-card p-4">
      <SectionTitle id="models-title" as="h3" aside={`${fmtPct(out.totals.defaultModelShare)} of runs stay on the default`}>
        Model choice and evals
      </SectionTitle>
      {out.models.length === 0 ? (
        <p className="type-body text-muted-foreground">No work in this pack has a model choice.</p>
      ) : (
        <Table>
          <TableCaption className="sr-only">Runs, credits and provider cost by model, with eval pass rates</TableCaption>
          <TableHeader>
            <TableRow>
              <TableHead scope="col">Work · model</TableHead>
              <TableHead scope="col" className="text-right">Runs</TableHead>
              <TableHead scope="col" className="text-right">Provider cost</TableHead>
              <TableHead scope="col" className="text-right">Eval pass</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {out.models.map((m) => {
              const ev = out.evalRuns.find((r) => r.suiteId === `${m.enrichment}-quality` && r.model === m.model);
              return (
                <TableRow key={`${m.enrichment}-${m.model}`}>
                  <TableHead scope="row" className="font-normal">
                    <div>{enrichLabel(m.enrichment)}</div>
                    <div className="type-caption text-muted-foreground">
                      {name(m.model)} {m.isDefault && <ToneBadge tone="watch">default</ToneBadge>}
                    </div>
                  </TableHead>
                  <TableCell className="text-right num">{fmtNum(m.runs)}</TableCell>
                  <TableCell className="text-right num">{fmtUsd(m.providerCost, 0)}</TableCell>
                  <TableCell className="text-right num">
                    {ev ? (
                      <>
                        {fmtPct(ev.passRate)}
                        {ev.vsDefault !== 0 && <div className="type-caption text-muted-foreground">{Math.round(ev.vsDefault * 100)} pts</div>}
                      </>
                    ) : (
                      "—"
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
      {out.suites.length > 0 && (
        <p className="type-caption text-muted-foreground">
          Evals: {out.suites.map((s) => `${s.name} (${s.cases} cases)`).join(" · ")}. Skill endpoints: {out.skills.map((s) => s.path).join(", ")}.
        </p>
      )}
    </section>
  );
}

function CohortTable({ t, rows, dim }: { t: TenantState; rows: SimOutput["cohorts"][CohortDimension]; dim: CohortDimension }) {
  const label = (key: string, l: string) => (dim === "region" ? regionById(key).name : dim === "plan" ? planOf(t.pack, key).name : l);
  const pct = (v: number | null) => (v == null ? "—" : fmtPct(v));
  return (
    <Table>
      <TableCaption className="sr-only">Cohorts by {COHORT_DIMENSIONS.find((d) => d.id === dim)?.label.toLowerCase()}: activation, retention by month, churn, top-ups and revenue</TableCaption>
      <TableHeader>
        <TableRow>
          <TableHead scope="col">Cohort</TableHead>
          <TableHead scope="col" className="text-right">Workspaces</TableHead>
          <TableHead scope="col" className="text-right">Activated</TableHead>
          <TableHead scope="col" className="text-right">Month 1</TableHead>
          <TableHead scope="col" className="text-right">Month 2</TableHead>
          <TableHead scope="col" className="text-right">Month 3</TableHead>
          <TableHead scope="col" className="text-right">Churned</TableHead>
          <TableHead scope="col" className="text-right">Top-ups</TableHead>
          <TableHead scope="col" className="text-right">Switched model</TableHead>
          <TableHead scope="col" className="text-right">{t.pack.meters[0].valueType === "currency" ? "Spend" : t.pack.meters[0].label} per workspace</TableHead>
          <TableHead scope="col" className="text-right">Monthly ARPU</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((r) => (
          <TableRow key={r.key}>
            <TableHead scope="row">{label(r.key, r.label)}</TableHead>
            <TableCell className="text-right num">{fmtNum(r.workspaces)}</TableCell>
            <TableCell className="text-right num">{pct(r.activatedPct)}</TableCell>
            <TableCell className="text-right num">{pct(r.m1)}</TableCell>
            <TableCell className="text-right num">{pct(r.m2)}</TableCell>
            <TableCell className="text-right num">{pct(r.m3)}</TableCell>
            <TableCell className="text-right num">{pct(r.churnedPct)}</TableCell>
            <TableCell className="text-right num">{pct(r.topUpPct)}</TableCell>
            <TableCell className="text-right num">{pct(r.switchedPct)}</TableCell>
            <TableCell className="text-right num">{t.pack.meters[0].valueType === "currency" ? fmtUsd(r.avgCredits, 0) : fmtNum(r.avgCredits)}</TableCell>
            <TableCell className="text-right num">{fmtUsd(r.arpu, 0)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function Busy({ label }: { label: string }) {
  return (
    <div className="space-y-3">
      <p role="status" className="type-body text-muted-foreground">
        {label}
      </p>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-16 rounded-lg" />
        ))}
      </div>
      <Skeleton className="h-[200px] rounded-xl" />
    </div>
  );
}

const SENTIMENT_TONE = { frustrated: "atRisk", neutral: "neutral", positive: "healthy" } as const;

export function ChatsTab({ t }: { t: TenantState }) {
  const out = usePopulation(t);
  const [intent, setIntent] = useState<ChatIntent | "all">("all");
  const [open, setOpen] = useState<string | null>(null);
  if (!out) return <Busy label="Simulating the population…" />;
  const chats = out.chats.filter((c) => intent === "all" || c.intent === intent);
  const sel = out.chats.find((c) => c.id === open) ?? chats[0] ?? null;
  const pack = t.pack;
  return (
    <section aria-labelledby="chats-title" className="space-y-3">
      <SectionTitle id="chats-title" aside={`${out.chats.length} transcripts · from the 90-day population (seed ${out.config.seed})`}>
        Help chats asking for free credits or discounts
      </SectionTitle>
      <div role="group" aria-label="Filter by intent" className="flex flex-wrap gap-1.5">
        <Button size="xs" variant={intent === "all" ? "default" : "outline"} aria-pressed={intent === "all"} onClick={() => setIntent("all")}>
          All <span className="num opacity-80">{out.chats.length}</span>
        </Button>
        {CHAT_INTENTS.map((i) => {
          const n = out.chats.filter((c) => c.intent === i.id).length;
          return n ? (
            <Button key={i.id} size="xs" variant={intent === i.id ? "default" : "outline"} aria-pressed={intent === i.id} onClick={() => setIntent(i.id)}>
              {i.label} <span className="num opacity-80">{n}</span>
            </Button>
          ) : null;
        })}
      </div>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,380px)_minmax(0,1fr)]">
        <ul className="divide-y divide-border rounded-xl border border-border bg-card" aria-label="Transcripts">
          {chats.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                onClick={() => setOpen(c.id)}
                aria-current={sel?.id === c.id ? "true" : undefined}
                className="flex w-full flex-col items-start gap-1 px-3 py-2.5 text-left hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring aria-[current=true]:bg-muted"
              >
                <span className="flex w-full items-center justify-between gap-2">
                  <span className="truncate type-body font-medium">{c.workspaceName}</span>
                  <span className="shrink-0 type-caption text-muted-foreground">{fmtDate(c.openedAt)}</span>
                </span>
                <span className="flex flex-wrap items-center gap-1.5">
                  <ToneBadge tone="info">{CHAT_INTENTS.find((i) => i.id === c.intent)?.label}</ToneBadge>
                  <span className="type-caption text-muted-foreground">
                    {planOf(pack, c.planId).name} · {regionById(c.region).shortName} · {c.outcome}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
        {sel && (
          <article aria-labelledby="chat-title" className="space-y-3 rounded-xl border border-border bg-card p-4">
            <header className="space-y-1">
              <h3 id="chat-title" className="type-heading">
                {sel.workspaceName} · {planOf(pack, sel.planId).name}
              </h3>
              <div className="flex flex-wrap items-center gap-1.5">
                <ToneBadge tone="info">{CHAT_INTENTS.find((i) => i.id === sel.intent)?.label}</ToneBadge>
                <ToneBadge tone={SENTIMENT_TONE[sel.sentiment]}>{sel.sentiment}</ToneBadge>
                {sel.signals.map((s) => (
                  <span key={s} className="rounded-md bg-muted px-1.5 py-0.5 font-mono type-caption">
                    {s}
                  </span>
                ))}
              </div>
              <p className="type-caption text-muted-foreground">
                {sel.id} · {sel.workspaceId} · {regionById(sel.region).name} · opened {new Date(sel.openedAt).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })} · outcome: {sel.outcome}
              </p>
            </header>
            <ol className="space-y-2">
              {sel.messages.map((m, i) => (
                <li key={i} className={cn("max-w-[85%] rounded-lg px-3 py-2 type-body", m.from === "customer" ? "bg-muted" : "ml-auto border border-border")}>
                  <span className="sr-only">{m.from === "customer" ? "Customer: " : "Support: "}</span>
                  {m.text}
                </li>
              ))}
            </ol>
          </article>
        )}
      </div>
    </section>
  );
}
