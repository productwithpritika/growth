// Product health (Phase 8 §8.4): the north-star metric (monetization-moment conversion value per
// active account), its inputs and guardrails, and the event taxonomy behind them.
import { useMemo } from "react";
import { Line, LineChart, YAxis } from "recharts";
import { ChartContainer, type ChartConfig } from "@/components/ui/chart";
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { SectionTitle } from "@/ui/primitives";
import { useTenant } from "@/lib/cockpit-store";
import { EVENT_TAXONOMY, productHealth, type Metric } from "@/platform/release";

const cfg = { y: { label: "Value", color: "var(--chart-1)" } } satisfies ChartConfig;

function Spark({ m, big = false }: { m: Metric; big?: boolean }) {
  if (m.trend.length < 2) return null;
  const first = m.trend[0].y;
  const last = m.trend[m.trend.length - 1].y;
  const dir = last > first ? "up" : last < first ? "down" : "flat";
  return (
    <ChartContainer config={cfg} className={`aspect-auto w-full ${big ? "h-24" : "h-10"}`} role="img" aria-label={`${m.label}: ${dir} over ${m.trend.length} weeks`}>
      <LineChart data={m.trend} margin={{ top: 4, right: 2, bottom: 2, left: 2 }}>
        <YAxis hide domain={["dataMin", "dataMax"]} />
        <Line dataKey="y" stroke="var(--color-y)" strokeWidth={2} dot={false} isAnimationActive={false} />
      </LineChart>
    </ChartContainer>
  );
}

function Card({ m }: { m: Metric }) {
  return (
    <li className="space-y-1 rounded-xl border border-border bg-card p-3">
      <div className="type-caption font-medium text-muted-foreground">{m.label}</div>
      <div className="num type-heading">{m.display}</div>
      <Spark m={m} />
      <p className="type-caption text-muted-foreground">
        {m.note} {m.good === "up" ? "Higher is better." : "Lower is better."}
      </p>
    </li>
  );
}

export function HealthPage() {
  const t = useTenant();
  const h = useMemo(() => productHealth(t), [t]);
  return (
    <div className="mx-auto max-w-[1440px] space-y-8 px-4 py-5 sm:px-6 sm:py-6">
      <div>
        <h1 className="type-title">Product health · {t.pack.company}</h1>
        <p className="type-body text-muted-foreground">The portal's own metric tree, computed from the simulated population and the live lab. Weekly, last eight weeks.</p>
      </div>
      <section aria-labelledby="ns-h" className="grid gap-4 rounded-xl border border-primary/40 bg-card p-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
        <div>
          <h2 id="ns-h" className="type-caption font-semibold uppercase tracking-wide text-muted-foreground">North star</h2>
          <div className="type-heading">{h.north.label}</div>
          <div className="num type-display">{h.north.display}</div>
          <p className="type-caption text-muted-foreground">{h.north.note}</p>
        </div>
        <Spark m={h.north} big />
      </section>
      <section aria-labelledby="in-h" className="space-y-3">
        <SectionTitle id="in-h">Inputs</SectionTitle>
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {h.inputs.map((m) => (
            <Card key={m.id} m={m} />
          ))}
        </ul>
      </section>
      <section aria-labelledby="gr-h" className="space-y-3">
        <SectionTitle id="gr-h">Guardrails</SectionTitle>
        <ul className="grid gap-3 sm:grid-cols-3">
          {h.guards.map((m) => (
            <Card key={m.id} m={m} />
          ))}
        </ul>
      </section>
      <section aria-labelledby="tax-h" className="space-y-3">
        <SectionTitle id="tax-h" aside={`${EVENT_TAXONOMY.length} events`}>
          Event taxonomy
        </SectionTitle>
        <Table>
          <TableCaption className="sr-only">Event names, properties and owners</TableCaption>
          <TableHeader>
            <TableRow>
              <TableHead scope="col">Event</TableHead>
              <TableHead scope="col">Properties</TableHead>
              <TableHead scope="col">Owner</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {EVENT_TAXONOMY.map((e) => (
              <TableRow key={e.name}>
                <TableHead scope="row" className="font-mono text-xs">{e.name}</TableHead>
                <TableCell className="whitespace-normal font-mono text-xs">{e.properties}</TableCell>
                <TableCell>{e.owner}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </section>
    </div>
  );
}
