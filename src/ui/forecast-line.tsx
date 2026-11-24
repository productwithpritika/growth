import { Area, CartesianGrid, ComposedChart, Line, ReferenceLine, XAxis, YAxis } from "recharts";
import { ChevronDown } from "lucide-react";
import type { Meter } from "@/tenants/schema";
import type { MeterTimeline } from "@/core/forecasting";
import { fmtNum } from "@/core/format";
import { useMoney } from "@/ui/money";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";

const config = {
  used: { label: "Used", color: "var(--chart-1)" },
  projected: { label: "Projected", color: "var(--chart-1)" },
  band: { label: "80% range", color: "var(--chart-1)" },
  available: { label: "Available", color: "var(--muted-foreground)" },
} satisfies ChartConfig;

export interface ForecastLineProps {
  meter: Meter;
  timeline: MeterTimeline;
  today: number;
  titleId: string;
  summaryId: string;
  height?: number;
  showTable?: boolean;
}

/** Cumulative use, projection with an 80% band, available credits and the run-out date. */
export function ForecastLine({ meter, timeline: tl, today, titleId, summaryId, height = 170, showTable = true }: ForecastLineProps) {
  const { amountNum, fmtUsd } = useMoney();
  const todayLabel = tl.points[today]?.label;
  const outLabel = tl.runsOutDay != null ? tl.points[tl.runsOutDay]?.label : null;
  const fmt = (v: number) => (meter.valueType === "currency" ? fmtUsd(v, 0) : fmtNum(v));
  return (
    <div>
      <ChartContainer config={config} className="aspect-auto w-full" style={{ height }} role="img" aria-labelledby={titleId} aria-describedby={summaryId}>
        <ComposedChart data={tl.points} margin={{ top: 14, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid vertical={false} />
          <XAxis dataKey="label" tickLine={false} axisLine={false} interval={6} tickMargin={6} />
          <YAxis width={meter.valueType === "currency" ? 68 : 52} tickLine={false} axisLine={false} tickFormatter={fmt} />
          <ChartTooltip content={<ChartTooltipContent />} />
          <Area dataKey="band" type="monotone" stroke="none" fill="var(--color-band)" fillOpacity={0.12} isAnimationActive={false} />
          <Area dataKey="used" type="monotone" stroke="var(--color-used)" fill="var(--color-used)" fillOpacity={0.12} strokeWidth={2} isAnimationActive={false} />
          <Line dataKey="projected" type="monotone" stroke="var(--color-projected)" strokeDasharray="5 4" strokeWidth={2} dot={false} isAnimationActive={false} />
          <Line dataKey="available" type="stepAfter" stroke="var(--color-available)" strokeWidth={1.5} dot={false} isAnimationActive={false} />
          {todayLabel && <ReferenceLine x={todayLabel} stroke="var(--control-border)" label={{ value: "Today", position: "top", fill: "var(--foreground)", fontSize: 11 }} />}
          {outLabel && <ReferenceLine x={outLabel} stroke="var(--color-used)" strokeDasharray="2 3" />}
        </ComposedChart>
      </ChartContainer>
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 type-caption text-muted-foreground">
        <span className="inline-flex items-center gap-1.5"><span aria-hidden="true" className="h-0.5 w-4 bg-primary" />Used</span>
        <span className="inline-flex items-center gap-1.5"><span aria-hidden="true" className="h-0 w-4 border-t-2 border-dashed border-primary" />Projected</span>
        <span className="inline-flex items-center gap-1.5"><span aria-hidden="true" className="h-2.5 w-4 rounded-sm bg-primary/15" />80% range</span>
        <span className="inline-flex items-center gap-1.5"><span aria-hidden="true" className="h-0.5 w-4 bg-muted-foreground" />Available</span>
        {outLabel && <span className="inline-flex items-center gap-1.5"><span aria-hidden="true" className="h-3 w-0 border-l-2 border-dotted border-primary" />Runs out</span>}
      </div>
      {showTable && (
        <Collapsible className="mt-1">
          <CollapsibleTrigger asChild>
            <Button variant="ghost" size="xs" className="group -ml-2 text-muted-foreground">
              Daily figures
              <ChevronDown aria-hidden="true" className="transition-transform group-data-[state=open]:rotate-180" />
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="max-h-56 overflow-y-auto">
              <Table>
                <TableCaption className="sr-only">{meter.label} by day this cycle</TableCaption>
                <TableHeader>
                  <TableRow>
                    <TableHead scope="col">Day</TableHead>
                    <TableHead scope="col" className="text-right">Used to date</TableHead>
                    <TableHead scope="col" className="text-right">Projected (80% range)</TableHead>
                    <TableHead scope="col" className="text-right">Available</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {tl.points.map((p) => (
                    <TableRow key={p.day}>
                      <TableHead scope="row" className="font-normal">{p.label}</TableHead>
                      <TableCell className="text-right num">{p.used != null ? amountNum(meter, p.used) : "—"}</TableCell>
                      <TableCell className="text-right num">
                        {p.projected != null && p.day > today && p.band ? `${amountNum(meter, p.projected)} (${amountNum(meter, p.band[0])}–${amountNum(meter, p.band[1])})` : "—"}
                      </TableCell>
                      <TableCell className="text-right num">{amountNum(meter, p.available)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CollapsibleContent>
        </Collapsible>
      )}
    </div>
  );
}
