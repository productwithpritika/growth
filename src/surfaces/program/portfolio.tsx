// Portfolio view (Phase 8 §8.3): modules on an impact versus effort grid, the dependency map
// (ledger and usage events → insights → experiments → evals → autonomy), and what ships first,
// later and why. Everything updates as flags change on the Roadmap page.
import { useMemo } from "react";
import { CartesianGrid, LabelList, ReferenceLine, Scatter, ScatterChart, XAxis, YAxis, ZAxis } from "recharts";
import { ChevronRight } from "lucide-react";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { SectionTitle } from "@/ui/primitives";
import { ToneBadge } from "@/ui/tone";
import type { Tone } from "@/core/types";
import { useTenant } from "@/lib/cockpit-store";
import { portfolio, type ModuleStatus } from "@/platform/release";

const TONE: Record<ModuleStatus, Tone> = { live: "healthy", "rolling-out": "info", killed: "blocked", blocked: "watch" };
const TEXT: Record<ModuleStatus, string> = { live: "Live", "rolling-out": "Rolling out", killed: "Killed", blocked: "Blocked" };
const config = { live: { label: "Live", color: "var(--chart-1)" }, other: { label: "Rolling out, blocked or killed", color: "var(--chart-4)" } } satisfies ChartConfig;

export function PortfolioPage() {
  const t = useTenant();
  const p = useMemo(() => portfolio(t.platform), [t.platform]);
  const quick = p.rows.filter((r) => r.impact >= 7 && r.effort <= 5);
  const pts = (pred: (s: ModuleStatus) => boolean) => p.rows.filter((r) => pred(r.status)).map((r) => ({ x: r.effort + ((r.key.length % 3) - 1) * 0.12, y: r.impact + ((r.label.length % 3) - 1) * 0.12, name: r.label }));
  return (
    <div className="mx-auto max-w-[1440px] space-y-8 px-4 py-5 sm:px-6 sm:py-6">
      <div>
        <h1 className="type-title">Portfolio</h1>
        <p className="type-body text-muted-foreground">What ships first, later and why. It reads the live feature flags, so killing a module on the Roadmap page shows here straight away.</p>
      </div>
      <section aria-labelledby="plan-h" className="space-y-2 rounded-xl border border-border bg-card p-4">
        <h2 id="plan-h" className="type-heading">Sequence</h2>
        <ol className="list-decimal space-y-1 pl-5 type-body">
          {p.plan.map((x) => (
            <li key={x}>{x}</li>
          ))}
        </ol>
      </section>
      <section aria-labelledby="dep-h" className="space-y-3">
        <SectionTitle id="dep-h">Dependency map</SectionTitle>
        <ol className="grid gap-3 lg:grid-cols-5">
          {p.layers.map((l, i) => (
            <li key={l.id} className="relative space-y-2 rounded-xl border border-border bg-card p-3">
              <div className="flex items-center justify-between gap-2">
                <h3 className="type-body font-semibold">
                  {i + 1}. {l.label}
                </h3>
                {i < p.layers.length - 1 && <ChevronRight aria-hidden="true" className="hidden size-4 text-muted-foreground lg:block" />}
              </div>
              <p className="type-caption text-muted-foreground">{l.why}</p>
              <ul className="space-y-1">
                {l.modules.map((m) => (
                  <li key={m.key} className="flex items-center justify-between gap-2 type-caption">
                    <span>{m.label}</span>
                    <ToneBadge tone={TONE[m.status]}>{TEXT[m.status]}</ToneBadge>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ol>
      </section>
      <section aria-labelledby="grid-h" className="space-y-3">
        <SectionTitle id="grid-h" aside={`Quick wins (impact 7+, effort 5 or less): ${quick.map((q) => q.label).join(", ")}`}>
          Impact versus effort
        </SectionTitle>
        <p id="grid-sum" className="sr-only">
          Scatter of {p.rows.length} modules by effort (1 to 10) and impact (1 to 10). The same data is in the table below.
        </p>
        <div className="rounded-xl border border-border bg-card p-4">
          <ChartContainer config={config} className="aspect-auto h-[420px] w-full" role="img" aria-labelledby="grid-h" aria-describedby="grid-sum">
            <ScatterChart margin={{ top: 16, right: 24, bottom: 24, left: 0 }}>
              <CartesianGrid strokeDasharray="2 4" />
              <XAxis type="number" dataKey="x" domain={[1, 10]} ticks={[2, 4, 6, 8, 10]} label={{ value: "Effort", position: "insideBottom", offset: -12, fill: "var(--foreground)", fontSize: 12 }} />
              <YAxis type="number" dataKey="y" domain={[4, 10]} width={36} label={{ value: "Impact", angle: -90, position: "insideLeft", fill: "var(--foreground)", fontSize: 12 }} />
              <ZAxis range={[60, 60]} />
              <ReferenceLine x={5.5} stroke="var(--muted-foreground)" strokeDasharray="4 4" />
              <ReferenceLine y={7} stroke="var(--muted-foreground)" strokeDasharray="4 4" />
              <ChartTooltip content={<ChartTooltipContent hideIndicator labelKey="name" />} />
              <Scatter name="Live" data={pts((s) => s === "live")} fill="var(--color-live)" isAnimationActive={false}>
                <LabelList dataKey="name" position="right" fontSize={10} fill="var(--foreground)" />
              </Scatter>
              <Scatter name="Other" data={pts((s) => s !== "live")} fill="var(--color-other)" isAnimationActive={false}>
                <LabelList dataKey="name" position="right" fontSize={10} fill="var(--foreground)" />
              </Scatter>
            </ScatterChart>
          </ChartContainer>
        </div>
        <Table>
          <TableCaption className="sr-only">Modules with impact, effort, layer, maturity and status</TableCaption>
          <TableHeader>
            <TableRow>
              <TableHead scope="col">Module</TableHead>
              <TableHead scope="col" className="text-right">Impact</TableHead>
              <TableHead scope="col" className="text-right">Effort</TableHead>
              <TableHead scope="col">Layer</TableHead>
              <TableHead scope="col">Maturity</TableHead>
              <TableHead scope="col">Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {[...p.rows].sort((a, b) => b.impact - b.effort - (a.impact - a.effort)).map((r) => (
              <TableRow key={r.key}>
                <TableHead scope="row">{r.label}</TableHead>
                <TableCell className="text-right tabular-nums">{r.impact}</TableCell>
                <TableCell className="text-right tabular-nums">{r.effort}</TableCell>
                <TableCell>{p.layers.find((l) => l.id === r.layer)?.label}</TableCell>
                <TableCell className="capitalize">{r.horizon}</TableCell>
                <TableCell>
                  <ToneBadge tone={TONE[r.status]}>{TEXT[r.status]}{r.status === "rolling-out" ? ` ${r.rollout}%` : ""}</ToneBadge>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </section>
    </div>
  );
}
