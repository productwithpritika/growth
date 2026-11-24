import { useMemo, useState } from "react";
import { toast } from "sonner";
import { CartesianGrid, ReferenceArea, Scatter, ScatterChart, XAxis, YAxis, ZAxis } from "recharts";
import { FastForward } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ChartContainer, ChartTooltip, type ChartConfig } from "@/components/ui/chart";
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { LiveStatus } from "@/components/live-status";
import { InsightList, SectionTitle, Stat } from "@/ui/primitives";
import { fmtNum, fmtPct, fmtUsd } from "@/core/format";
import { ChurnPanel, ControlsPanel, EconomicsPanel, OptimiserPanel } from "@/surfaces/workbench/panels";
import { useCockpit } from "@/lib/cockpit-store";
import { personaRole, type PersonaId } from "@/tenants/personas";
import { visible, WB_NAV } from "@/components/nav";
import { OnboardPanel } from "@/surfaces/workbench/onboard";
import { StartPanel } from "@/surfaces/workbench/start";
import { TodayPanel } from "@/surfaces/workbench/today";
import { CohortsPanel } from "@/surfaces/workbench/cohorts";
import { HypothesesPanel } from "@/surfaces/workbench/hypotheses";
import { LabPanel } from "@/surfaces/workbench/lab";
import { PlaysPanel } from "@/surfaces/workbench/plays";
import { AskPage } from "@/surfaces/workbench/ask";
import { ArrestPanel, BreakagePanel, PersonaPlansPanel, RewardsStudioPanel } from "@/surfaces/workbench/loop-panels";
import { TourDock } from "@/surfaces/workbench/tour";
import { useWb } from "@/surfaces/workbench/scope";
import { isKilled } from "@/platform/release";
import { EvalsPanel } from "@/surfaces/workbench/evals";
import { McpConsole } from "@/surfaces/workbench/mcp-console";
import { AgentsPage } from "@/surfaces/workbench/agents";
import { ExperiencesPanel } from "@/surfaces/workbench/experiences";
import { EmbedPanel } from "@/surfaces/workbench/embed";
import { PackBuilder } from "@/surfaces/workbench/pack-builder";
import { advanceDay } from "@/sim/seed";
import { STATUS_LABEL } from "@/growth/lab";
import {
  cohortDefs,
  hasSecondary,
  median,
  monthlyAllowance,
  planOf,
  primaryMeter,
  secondaryMeter,
  workbenchInsights,
  workbenchStats,
  TODAY_INDEX,
  cycleOf,
  type Account,
  type TenantState,
  type WorkbenchStats,
} from "@/core";
import type { Plan, TenantPack, WorkbenchTab } from "@/tenants/schema";
import { cn } from "@/lib/utils";

const LEGACY: WorkbenchTab[] = ["churn", "optimiser", "economics", "controls", "onboard"];

export function WorkbenchPage({ personaId }: { personaId: Extract<PersonaId, "nia" | "sam"> }) {
  const { t, run: wbRun, sandbox } = useWb();
  const setUi = useCockpit((s) => s.setUi);
  const tab = useCockpit((s) => s.wbTab);
  const horizon = useCockpit((s) => s.horizon);
  const [said, setSaid] = useState({ n: 0, text: "" });
  const pack = t.pack;
  const stats = useMemo(() => workbenchStats(pack), [pack]);
  const prim = primaryMeter(pack);
  const tabs = visible(WB_NAV, horizon, (k) => isKilled(t.platform, k));
  const current = tabs.find((x) => x.wbTab === tab)?.wbTab ?? tabs[0]?.wbTab ?? "economics";
  const name = personaId === "nia" ? "Nia" : "Sam";
  const prepaid = pack.billingModel === "prepaid";
  const legacy = LEGACY.includes(current);

  const run: WbRun = (fn, okText) => {
    const saved = wbRun(fn, okText);
    setSaid((s) => ({ n: s.n + 1, text: saved ? okText : `${okText} Not saved in this browser.` }));
  };

  return (
    <div className="mx-auto max-w-[1440px] space-y-6 px-4 py-5 sm:px-6 sm:py-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <h1 className="type-title">Growth Workbench · {pack.company}</h1>
          <p className="type-body text-muted-foreground">
            {name} · {personaRole(pack, personaId)}
          </p>
        </div>
        {legacy ? (
          <div className="grid grid-cols-2 gap-x-8 gap-y-3 sm:grid-cols-4">
            <Stat label={prepaid ? "Monthly usage revenue" : "Paid MRR"} value={fmtUsd(stats.mrr, 0)} sub={`${fmtNum(stats.paid.length)} paid accounts · billing sample`} />
            <Stat label={`${pack.plans.find((p) => !p.paid)?.name ?? "Free"} at a cap`} value={fmtNum(stats.freeCapped.length)} sub="this cycle" />
            <Stat label={prepaid ? "Gross margin" : `Margin per ${prim.label.replace(/s$/, "")}`} value={prepaid ? fmtPct(stats.marginPct) : fmtUsd(stats.marginPerUnit, 3)} sub={prepaid ? "on usage" : fmtPct(stats.marginPct)} />
            <Stat label="Breakage" value={fmtUsd(stats.breakageUsd, 0)} sub="expires this cycle" />
          </div>
        ) : (
          <TimeMachine />
        )}
      </div>
      {sandbox && (
        <div role="status" className="rounded-lg border border-info bg-info-soft px-4 py-2 type-body text-info-ink">
          Tour sandbox: the agent is working in a copy of your Workbench. Nothing here changes live configuration until you approve the launch.
        </div>
      )}

      <Tabs value={current} onValueChange={(v) => setUi({ wbTab: v as WorkbenchTab })}>
        <TabsList variant="line" aria-label="Workbench sections" className="w-full flex-nowrap overflow-x-auto lg:hidden">
          {tabs.map((x) => (
            <TabsTrigger key={x.id} value={x.wbTab!}>
              {x.label}
            </TabsTrigger>
          ))}
        </TabsList>
        <h2 className="sr-only">{tabs.find((x) => x.wbTab === current)?.label}</h2>
        <TabsContent value="start" className="pt-4">
          <StartPanel />
        </TabsContent>
        <TabsContent value="today" className="pt-4">
          <TodayPanel />
        </TabsContent>
        <TabsContent value="overview" className="pt-4">
          <CohortsPanel usageMap={<Overview t={t} stats={stats} />} />
        </TabsContent>
        <TabsContent value="hypotheses" className="pt-4">
          <HypothesesPanel />
        </TabsContent>
        <TabsContent value="experiments" className="pt-4">
          <LabPanel />
        </TabsContent>
        <TabsContent value="plays" className="pt-4">
          <PlaysPanel />
        </TabsContent>
        <TabsContent value="ask" className="pt-4">
          <AskPage />
        </TabsContent>
        <TabsContent value="churn" className="space-y-8 pt-4">
          <ArrestPanel />
          <div className="space-y-3">
            <SectionTitle as="h2" aside="Billing sample, this cycle">
              Voluntary churn: at-risk accounts and save plays
            </SectionTitle>
            <ChurnPanel t={t} stats={stats} run={run} />
          </div>
        </TabsContent>
        <TabsContent value="optimiser" className="space-y-8 pt-4">
          <PersonaPlansPanel />
          <div className="space-y-3">
            <SectionTitle as="h2" aside="Billing sample, this cycle">
              Plan ladder and proposals
            </SectionTitle>
            <OptimiserPanel t={t} run={run} />
          </div>
        </TabsContent>
        <TabsContent value="breakage" className="pt-4">
          <BreakagePanel />
        </TabsContent>
        <TabsContent value="rewards" className="pt-4">
          <RewardsStudioPanel />
        </TabsContent>
        <TabsContent value="economics" className="pt-4">
          <EconomicsPanel t={t} stats={stats} run={run} />
        </TabsContent>
        <TabsContent value="controls" className="pt-4">
          <ControlsPanel t={t} stats={stats} run={run} />
        </TabsContent>
        <TabsContent value="onboard" className="pt-4">
          <OnboardPanel />
        </TabsContent>
        <TabsContent value="evals" className="pt-4">
          <EvalsPanel />
        </TabsContent>
        <TabsContent value="mcp" className="pt-4">
          <McpConsole />
        </TabsContent>
        <TabsContent value="agents" className="pt-4">
          <AgentsPage />
        </TabsContent>
        <TabsContent value="experiences" className="pt-4">
          <ExperiencesPanel />
        </TabsContent>
        <TabsContent value="embed" className="pt-4">
          <EmbedPanel />
        </TabsContent>
        <TabsContent value="packs" className="pt-4">
          <PackBuilder />
        </TabsContent>
      </Tabs>
      <TourDock />
      <LiveStatus>{said.n > 0 ? `${said.text} (${said.n})` : ""}</LiveStatus>
    </div>
  );
}

/** Fast-forwards the simulated clock so the experiment loop is demonstrable in minutes. */
function TimeMachine() {
  const apply = useCockpit((s) => s.apply);
  const { live } = useWb();
  const { day } = cycleOf(live);
  const move = (n: number) => {
    const before = new Map(live.growth.lab.map((e) => [e.id, e.status]));
    let after: TenantState | null = null;
    const ok = apply((s) => {
      let x = s;
      for (let i = 0; i < n; i++) x = advanceDay(x);
      after = x;
      return x;
    });
    const changed = after ? (after as TenantState).growth.lab.filter((e) => before.get(e.id) && before.get(e.id) !== e.status) : [];
    const msg = changed.length ? changed.map((e) => `${e.name}: ${STATUS_LABEL[e.status].toLowerCase()}`).join(" · ") : "No experiment changed state.";
    toast[ok ? "success" : "error"](`Moved ${n} day${n === 1 ? "" : "s"} forward. ${msg}`);
  };
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-card px-3 py-2" role="group" aria-label="Time machine">
      <div className="pr-2">
        <div className="type-caption font-medium text-muted-foreground">Time machine</div>
        <div className="type-body font-semibold num">
          {new Date(live.clock).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })} · day {day + 1}
        </div>
      </div>
      {[1, 3, 7].map((n) => (
        <Button key={n} size="sm" variant="outline" onClick={() => move(n)} aria-label={`Move the simulated clock ${n} day${n === 1 ? "" : "s"} forward`}>
          <FastForward aria-hidden="true" />+{n} day{n === 1 ? "" : "s"}
        </Button>
      ))}
    </div>
  );
}

export type WbRun = (fn: (s: TenantState) => TenantState, okText: string) => void;

/** The usage-map ceiling a plan sets on a meter: its monthly allowance, or for prepaid tiers the spend cap. */
function envelope(pack: TenantPack, p: Plan, meterId: string): number {
  if (pack.billingModel === "prepaid") return p.caps.monthlySpend ?? 0;
  return monthlyAllowance(pack, p.id, meterId);
}

const mapConfig = {
  cohort: { label: "In cohort", color: "var(--chart-1)" },
  other: { label: "Other accounts", color: "var(--muted-foreground)" },
} satisfies ChartConfig;

function Overview({ t, stats }: { t: TenantState; stats: WorkbenchStats }) {
  const pack = t.pack;
  const setUi = useCockpit((s) => s.setUi);
  const cohortId = useCockpit((s) => s.cohort);
  const prim = primaryMeter(pack);
  const sec = secondaryMeter(pack);
  const defs = useMemo(() => cohortDefs(pack), [pack]);
  const members = useMemo(() => {
    const out = new Map<string, Account[]>();
    for (const d of defs) out.set(d.id, stats.accounts.filter((a) => d.test(a, stats.projections.get(a.id)!, planOf(pack, a.planId))));
    return out;
  }, [defs, stats, pack]);
  const def = defs.find((d) => d.id === cohortId) ?? defs[0];
  const inC = members.get(def.id) ?? [];
  const inSet = new Set(inC.map((a) => a.id));
  const two = hasSecondary(pack);
  const xLabel = two ? sec.label : pack.workUnit.many.replace(/^./, (c) => c.toUpperCase());
  const xOf = (a: Account) => (two ? (a.demand[sec.id] ?? 0) : a.units);
  const xMin = two ? 10 : 1;
  const pt = (a: Account) => ({ x: Math.max(xMin, xOf(a)), y: Math.max(1, a.demand[prim.id] ?? 0), name: a.name, plan: planOf(pack, a.planId).name });
  const cohortPts = inC.map(pt);
  const otherPts = stats.accounts.filter((a) => !inSet.has(a.id)).map(pt);
  const envelopes = pack.plans.filter((p) => p.price != null && envelope(pack, p, prim.id) > 1);
  const maxX = Math.max(...stats.accounts.map(xOf), ...(two ? envelopes.map((p) => envelope(pack, p, sec.id)) : [])) * 1.3;
  const maxY = Math.max(...stats.accounts.map((a) => a.demand[prim.id] ?? 0), ...envelopes.map((p) => envelope(pack, p, prim.id))) * 1.3;
  const ticks = (max: number, min: number) => [1, 10, 100, 1000, 10000, 100000, 1000000].filter((v) => v >= min && v <= max);
  const insights = workbenchInsights(t);

  const mrr = inC.reduce((s, a) => s + (stats.projections.get(a.id)?.revenue ?? 0), 0);
  const breakage = inC.reduce((s, a) => s + (stats.projections.get(a.id)?.breakageUsd ?? 0), 0);
  const capped = inC.filter((a) => (stats.projections.get(a.id)?.capDay ?? 99) <= TODAY_INDEX).length;

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
      <section aria-labelledby="map-title" className="min-w-0 space-y-3 rounded-xl border border-border bg-card p-5">
        <SectionTitle id="map-title" aside={`${fmtNum(stats.accounts.length)} accounts · monthly demand, log scale`}>
          Usage map
        </SectionTitle>
        <p id="map-summary" className="text-sm text-muted-foreground">
          {def.label}: {fmtNum(inC.length)} accounts highlighted.{" "}
          {pack.billingModel === "prepaid"
            ? "Dashed lines are tier spend caps; points above a line spend more than that tier allows."
            : two
              ? "Dashed boxes are plan allowances; points outside a box need more than that plan includes."
              : "Dashed lines are plan allowances; points above a line need more than that plan includes."}
        </p>
        <ChartContainer config={mapConfig} className="aspect-auto h-[380px] w-full" role="img" aria-labelledby="map-title" aria-describedby="map-summary">
          <ScatterChart margin={{ top: 16, right: 16, bottom: 20, left: 4 }}>
            <CartesianGrid strokeDasharray="2 4" />
            <XAxis type="number" dataKey="x" name={xLabel} scale="log" domain={[xMin, maxX]} ticks={ticks(maxX, xMin)} tickFormatter={(v: number) => fmtNum(v)} allowDataOverflow label={{ value: `${xLabel} per month`, position: "insideBottom", offset: -12, fill: "var(--foreground)", fontSize: 12 }} />
            <YAxis type="number" dataKey="y" name={prim.label} scale="log" domain={[1, maxY]} ticks={ticks(maxY, 1)} tickFormatter={(v: number) => fmtNum(v)} allowDataOverflow width={62} label={{ value: prim.label, angle: -90, position: "insideLeft", fill: "var(--foreground)", fontSize: 12, dy: 40 }} />
            <ZAxis range={[22, 22]} />
            {envelopes.map((p) => (
              <ReferenceArea
                key={p.id}
                x1={xMin}
                x2={two ? envelope(pack, p, sec.id) : maxX}
                y1={1}
                y2={envelope(pack, p, prim.id)}
                fill="none"
                stroke="var(--foreground)"
                strokeOpacity={p.proposed ? 0.45 : 0.7}
                strokeDasharray={p.proposed ? "2 4" : "6 4"}
                label={{ value: p.proposed ? `${p.name} (proposed)` : p.name, position: "insideTopRight", fill: "var(--foreground)", fontSize: 11 }}
              />
            ))}
            <ChartTooltip cursor={false} content={<MapTip primLabel={prim.label} secLabel={xLabel.toLowerCase()} />} />
            <Scatter name="Other accounts" data={otherPts} fill="var(--color-other)" fillOpacity={0.3} isAnimationActive={false} />
            <Scatter name="In cohort" data={cohortPts} fill="var(--color-cohort)" fillOpacity={0.85} isAnimationActive={false} />
          </ScatterChart>
        </ChartContainer>
        <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1.5"><span aria-hidden="true" className="size-2.5 rounded-full bg-primary" />{def.label}</span>
          <span className="inline-flex items-center gap-1.5"><span aria-hidden="true" className="size-2.5 rounded-full bg-muted-foreground/40" />Other accounts</span>
        </div>
        <Table>
          <TableCaption className="sr-only">Accounts by plan with median monthly demand</TableCaption>
          <TableHeader>
            <TableRow>
              <TableHead scope="col">Plan</TableHead>
              <TableHead scope="col" className="text-right">Accounts</TableHead>
              <TableHead scope="col" className="text-right">In cohort</TableHead>
              <TableHead scope="col" className="text-right">Median {prim.label}</TableHead>
              <TableHead scope="col" className="text-right">Median {xLabel.toLowerCase()}</TableHead>
              <TableHead scope="col" className="text-right">Beyond allowance</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {Object.keys(pack.demo.population.profiles).map((pid) => {
              const p = planOf(pack, pid);
              const xs = stats.accounts.filter((a) => a.planId === pid);
              const beyond = xs.filter((a) => pack.meters.some((m) => (a.demand[m.id] ?? 0) > envelope(pack, p, m.id))).length;
              return (
                <TableRow key={pid}>
                  <TableHead scope="row">{p.name}</TableHead>
                  <TableCell className="text-right tabular-nums">{fmtNum(xs.length)}</TableCell>
                  <TableCell className="text-right tabular-nums">{fmtNum(xs.filter((a) => inSet.has(a.id)).length)}</TableCell>
                  <TableCell className="text-right tabular-nums">{fmtNum(median(xs.map((a) => a.demand[prim.id] ?? 0)))}</TableCell>
                  <TableCell className="text-right tabular-nums">{fmtNum(median(xs.map(xOf)))}</TableCell>
                  <TableCell className="text-right tabular-nums">{xs.length && envelope(pack, p, prim.id) > 0 ? fmtPct(beyond / xs.length) : "—"}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </section>

      <div className="space-y-6">
        <section aria-labelledby="cohorts-title" className="space-y-3">
          <SectionTitle id="cohorts-title">Cohorts</SectionTitle>
          <div role="group" aria-label="Cohort" className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
            {defs.map((d) => {
              const active = d.id === def.id;
              return (
                <button
                  key={d.id}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setUi({ cohort: d.id })}
                  className={cn("flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left text-sm focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring", active ? "bg-muted font-semibold" : "hover:bg-muted")}
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <span aria-hidden="true" className={cn("h-4 w-1 rounded-full", active ? "bg-primary" : "bg-transparent")} />
                    {d.label}
                  </span>
                  <span className="tabular-nums">{fmtNum(members.get(d.id)?.length ?? 0)}</span>
                </button>
              );
            })}
          </div>
        </section>
        <section aria-labelledby="cohort-detail" className="space-y-3 rounded-xl border border-border bg-card p-4">
          <h2 id="cohort-detail" className="text-sm font-semibold">{def.label}</h2>
          <div className="grid grid-cols-3 gap-3">
            <Stat label="MRR" value={fmtUsd(mrr, 0)} />
            <Stat label="Hit a cap" value={fmtNum(capped)} />
            <Stat label="Breakage" value={fmtUsd(breakage, 0)} />
          </div>
        </section>
        <section aria-labelledby="wb-insights" className="space-y-2">
          <SectionTitle id="wb-insights" aside="From the brain">
            Insights
          </SectionTitle>
          <InsightList items={insights} empty="No insights yet." />
        </section>
      </div>
    </div>
  );
}

function MapTip({ active, payload, primLabel, secLabel }: { active?: boolean; payload?: { payload: { x: number; y: number; name: string; plan: string } }[]; primLabel: string; secLabel: string }) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  return (
    <div className="rounded-lg border border-border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-md">
      <div className="font-semibold">{p.name}</div>
      <div>{p.plan}</div>
      <div className="tabular-nums">
        {fmtNum(p.y)} {primLabel} · {fmtNum(p.x)} {secLabel}
      </div>
    </div>
  );
}
