// Today (Phase 5 §5.1): what is true now, with as-of times. Every tile drills into a cohort or
// the ledger.
import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import { CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";
import { Button } from "@/components/ui/button";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { SectionTitle, Stat } from "@/ui/primitives";
import { ToneBadge, TONE_MARK } from "@/ui/tone";
import { useCockpit } from "@/lib/cockpit-store";
import { useWb } from "@/surfaces/workbench/scope";
import { todaySnapshot } from "@/growth/analytics";
import { primaryMeter } from "@/core/pack";
import { fmtNum, fmtPct, fmtUsd } from "@/core/format";
import type { WorkbenchTab } from "@/tenants/schema";
import { cn } from "@/lib/utils";

const burnConfig = { y: { label: "Credits", color: "var(--chart-1)" } } satisfies ChartConfig;

export function TodayPanel() {
  const { t } = useWb();
  const setUi = useCockpit((s) => s.setUi);
  const navigate = useNavigate();
  const s = useMemo(() => todaySnapshot(t), [t]);
  const prim = primaryMeter(t.pack);
  const asOf = new Date(s.asOf).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  const drill = (tab: WorkbenchTab, segment?: string) => setUi({ wbTab: tab, ...(segment ? { segment } : {}) });
  const toLedger = () => {
    setUi({ brainTab: "ledger" });
    navigate("/brain");
  };
  const m = s.mrr;
  const moves = [
    { label: "New", v: m.new, tone: "healthy" as const, go: () => drill("overview", "new-signups") },
    ...(t.pack.billingModel === "prepaid" ? [] : [{ label: "Expansion (top-ups)", v: m.expansion, tone: "healthy" as const, go: toLedger }]),
    { label: "Contraction", v: -m.contraction, tone: "watch" as const, go: () => drill("overview", "quiet-credits") },
    { label: "Churn", v: -m.churn, tone: "blocked" as const, go: () => drill("churn") },
  ];
  const max = Math.max(...moves.map((x) => Math.abs(x.v)), 1);
  const trend = s.credits.burnPrev ? s.credits.burnPerDay / s.credits.burnPrev - 1 : 0;
  const churnTotal = s.churn.voluntary + s.churn.involuntary;
  return (
    <div className="space-y-6">
      <p className="type-caption text-muted-foreground">
        As of {asOf} · population simulator scaled {s.scale}× · every tile opens the cohort or ledger behind it
      </p>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Tile label={t.pack.billingModel === "prepaid" ? "Monthly usage revenue" : "MRR"} value={fmtUsd(m.total, 0)} sub={`${m.net >= 0 ? "+" : "−"}${fmtUsd(Math.abs(m.net), 0)} net this month`} onClick={() => drill("overview", "paid-topup")} cta="Open thriving cohorts" />
        <Tile label={`${prim.label} burned a day`} value={fmtNum(s.credits.burnPerDay)} sub={`${trend >= 0 ? "Up" : "Down"} ${fmtPct(Math.abs(trend))} on last week`} onClick={toLedger} cta="Open the ledger" />
        <Tile label="Top-up attach rate" value={fmtPct(s.credits.attach)} sub="of paid workspaces in 90 days" onClick={() => drill("overview", "paid-topup")} cta="See who tops up" />
        <Tile label="Breakage share" value={fmtPct(s.credits.breakageShare)} sub="of paid grants expiring unused" onClick={() => drill("breakage")} cta="Open the breakage pool" />
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <section aria-labelledby="mrr-h" className="space-y-3 rounded-xl border border-border bg-card p-4">
          <SectionTitle id="mrr-h" aside="Last 30 days">
            Recurring revenue movements
          </SectionTitle>
          <ul className="space-y-2">
            {moves.map((x) => (
              <li key={x.label}>
                <button type="button" onClick={x.go} className="grid w-full grid-cols-[minmax(0,40%)_1fr_auto] items-center gap-3 rounded-md px-1 py-1 text-left hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring">
                  <span className="type-body">{x.label}</span>
                  <span aria-hidden="true" className="h-2.5 overflow-hidden rounded-full bg-muted">
                    <span className={cn("block h-full rounded-full", TONE_MARK[x.tone])} style={{ width: `${(Math.abs(x.v) / max) * 100}%` }} />
                  </span>
                  <span className="num type-body font-medium">
                    {x.v < 0 ? "−" : "+"}
                    {fmtUsd(Math.abs(x.v), 0)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>

        <section aria-labelledby="burn-h" className="space-y-3 rounded-xl border border-border bg-card p-4">
          <SectionTitle id="burn-h" aside="All workspaces, last 30 days">
            {prim.label} burn
          </SectionTitle>
          <ChartContainer config={burnConfig} className="aspect-auto h-48 w-full" role="img" aria-labelledby="burn-h" aria-describedby="burn-sum">
            <LineChart data={s.burnSeries} margin={{ top: 6, right: 8, bottom: 0, left: 0 }}>
              <CartesianGrid strokeDasharray="2 4" vertical={false} />
              <XAxis dataKey="x" tickLine={false} axisLine={false} fontSize={11} minTickGap={24} />
              <YAxis tickLine={false} axisLine={false} fontSize={11} width={52} tickFormatter={(v: number) => (v >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : `${Math.round(v / 1e3)}k`)} />
              <ChartTooltip content={<ChartTooltipContent />} />
              <Line dataKey="y" name={prim.label} stroke="var(--color-y)" strokeWidth={2} dot={false} isAnimationActive={false} />
            </LineChart>
          </ChartContainer>
          <p id="burn-sum" className="type-caption text-muted-foreground">
            7-day average {fmtNum(s.credits.burnPerDay)} a day against {fmtNum(s.credits.burnPrev)} the week before.
          </p>
        </section>
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <section aria-labelledby="funnel-h" className="space-y-3 rounded-xl border border-border bg-card p-4">
          <SectionTitle id="funnel-h" aside="Signups in the last 90 days">
            Free-to-paid funnel
          </SectionTitle>
          <ol className="space-y-2">
            {s.funnel.map((f, i) => (
              <li key={f.label}>
                <button type="button" onClick={() => drill("overview", i === 1 ? "free-activated" : i === 0 ? "new-signups" : i === 2 ? "free-blocked" : "paid-all")} className="grid w-full grid-cols-[minmax(0,45%)_1fr_auto] items-center gap-3 rounded-md px-1 py-1 text-left hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring">
                  <span className="type-body">{f.label}</span>
                  <span aria-hidden="true" className="h-2.5 overflow-hidden rounded-full bg-muted">
                    <span className="block h-full rounded-full bg-info" style={{ width: `${(f.n / Math.max(1, s.funnel[0].n)) * 100}%` }} />
                  </span>
                  <span className="num type-body font-medium">
                    {fmtNum(f.n)} <span className="type-caption text-muted-foreground">{i ? fmtPct(f.n / Math.max(1, s.funnel[0].n)) : ""}</span>
                  </span>
                </button>
              </li>
            ))}
          </ol>
          <Button size="xs" variant="ghost" onClick={() => drill("overview", "free-quiet")}>
            The biggest drop: quiet before a first enrichment
            <ArrowRight aria-hidden="true" />
          </Button>
        </section>

        <section aria-labelledby="churn-h" className="space-y-3 rounded-xl border border-border bg-card p-4">
          <SectionTitle id="churn-h" aside="Paid workspaces that left in the last 30 days">
            Voluntary and involuntary churn
          </SectionTitle>
          <div className="grid grid-cols-2 gap-4">
            <button type="button" onClick={() => drill("overview", "paid-month3")} className="rounded-lg border border-border p-3 text-left hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring">
              <Stat label="Voluntary" value={fmtNum(s.churn.voluntary)} sub={`${fmtUsd(s.churn.voluntaryMrr, 0)} MRR · ${churnTotal ? fmtPct(s.churn.voluntary / churnTotal) : "0%"}`} />
            </button>
            <button type="button" onClick={() => drill("churn")} className="rounded-lg border border-border p-3 text-left hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring">
              <Stat label="Involuntary (failed payment)" value={fmtNum(s.churn.involuntary)} sub={`${fmtUsd(s.churn.involuntaryMrr, 0)} MRR · ${churnTotal ? fmtPct(s.churn.involuntary / churnTotal) : "0%"}`} />
            </button>
          </div>
          <p className="type-caption text-muted-foreground">Involuntary churn is recoverable: open Churn arrest for the queue and the levers.</p>
        </section>
      </div>

      <section aria-labelledby="mpc-h" className="space-y-3">
        <SectionTitle id="mpc-h" aside={`List price ${fmtUsd(prim.pricePerUnit, 4)} per ${prim.unit.replace(/s$/, "")}`}>
          Gross margin per credit by model
        </SectionTitle>
        <Table>
          <TableCaption className="sr-only">Credits, provider cost and margin per credit for each model</TableCaption>
          <TableHeader>
            <TableRow>
              <TableHead scope="col">Model</TableHead>
              <TableHead scope="col" className="text-right">Credits (90 days)</TableHead>
              <TableHead scope="col" className="text-right">Cost per credit</TableHead>
              <TableHead scope="col" className="text-right">Margin per credit</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {s.credits.byModel.map((x) => (
              <TableRow key={x.model}>
                <TableHead scope="row" className="font-normal">{x.name}</TableHead>
                <TableCell className="text-right num">{fmtNum(x.credits)}</TableCell>
                <TableCell className="text-right num">{fmtUsd(x.costPerCredit, 4)}</TableCell>
                <TableCell className="text-right">
                  <ToneBadge tone={x.marginPerCredit < prim.pricePerUnit * 0.4 ? "watch" : "healthy"}>{fmtUsd(x.marginPerCredit, 4)}</ToneBadge>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </section>
    </div>
  );
}

function Tile({ label, value, sub, onClick, cta }: { label: string; value: string; sub: string; onClick: () => void; cta: string }) {
  return (
    <button type="button" onClick={onClick} className="group flex flex-col items-start gap-1 rounded-xl border border-border bg-card p-4 text-left hover:border-primary/50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
      <Stat label={label} value={value} sub={sub} />
      <span className="mt-1 inline-flex items-center gap-1 type-caption font-medium text-primary">
        {cta}
        <ArrowRight aria-hidden="true" className="size-3.5" />
      </span>
    </button>
  );
}
