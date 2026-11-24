// Live components inside Ask CB answers: tables, bars, a series chart, hypothesis cards, a
// scorecard, plan diffs, a research brief with citations, the command list and Memory cards.
import { CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";
import { BookmarkPlus, Check } from "lucide-react";
import type { Block, HypothesisLite, MemoryCard } from "@/growth/types";
import type { TenantState } from "@/core/types";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { ToneBadge, TONE_MARK } from "@/ui/tone";
import { LabScorecard } from "@/ui/lab-scorecard";
import { kbCard } from "@/agents/cb/engine";
import { cn } from "@/lib/utils";

const CONF_TONE = { high: "healthy", medium: "info", low: "watch" } as const;
const seriesConfig = { y: { label: "Value", color: "var(--chart-1)" } } satisfies ChartConfig;

export interface BlockActions {
  onPick?: (h: HypothesisLite) => void;
  onDraft?: (h: HypothesisLite) => void;
  picked?: string | null;
  onSave?: (sections: Extract<Block, { kind: "research" }>["sections"], plan: string[]) => void;
  saved?: boolean;
  onCommand?: (cmd: string) => void;
  sandbox?: boolean;
}

export function AnswerBlock({ b, t, actions, idx }: { b: Block; t: TenantState; actions: BlockActions; idx: string }) {
  switch (b.kind) {
    case "kv":
      return (
        <section className="rounded-lg border border-border">
          {b.title && <h4 className="border-b border-border px-3 py-2 type-caption font-semibold">{b.title}</h4>}
          <dl className="divide-y divide-border">
            {b.rows.map(([k, v]) => (
              <div key={k} className="grid grid-cols-[minmax(0,40%)_1fr] gap-3 px-3 py-1.5 type-caption">
                <dt className="text-muted-foreground">{k}</dt>
                <dd className="font-medium">{v}</dd>
              </div>
            ))}
          </dl>
        </section>
      );
    case "table":
      return (
        <div className="overflow-x-auto rounded-lg border border-border">
          <Table>
            <TableCaption className="caption-top px-3 pt-2 text-left type-caption font-semibold text-foreground">{b.title ?? "Results"}</TableCaption>
            <TableHeader>
              <TableRow>
                {b.columns.map((c, i) => (
                  <TableHead key={c} scope="col" className={cn(b.numeric?.includes(i) && "text-right")}>
                    {c}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {b.rows.map((r, ri) => (
                <TableRow key={ri}>
                  {r.map((c, i) =>
                    i === 0 ? (
                      <TableHead key={i} scope="row" className="font-normal">
                        {c}
                      </TableHead>
                    ) : (
                      <TableCell key={i} className={cn(b.numeric?.includes(i) && "text-right num")}>
                        {c}
                      </TableCell>
                    ),
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      );
    case "bars": {
      const max = Math.max(...b.items.map((i) => Math.abs(i.value)), 1e-9);
      return (
        <section className="rounded-lg border border-border p-3">
          {b.title && <h4 className="mb-2 type-caption font-semibold">{b.title}</h4>}
          <ul className="space-y-1.5">
            {b.items.map((i) => (
              <li key={i.label} className="grid grid-cols-[minmax(0,38%)_1fr_auto] items-center gap-2 type-caption">
                <span className="truncate" title={i.label}>
                  {i.label}
                </span>
                <span aria-hidden="true" className="h-2 overflow-hidden rounded-full bg-muted">
                  <span className={cn("block h-full rounded-full", TONE_MARK[i.tone ?? "info"])} style={{ width: `${Math.max(2, (Math.abs(i.value) / max) * 100)}%` }} />
                </span>
                <span className="num font-medium">{i.display}</span>
              </li>
            ))}
          </ul>
        </section>
      );
    }
    case "series":
      return (
        <section className="rounded-lg border border-border p-3">
          {b.title && <h4 id={`s-${idx}`} className="mb-1 type-caption font-semibold">{b.title}</h4>}
          <ChartContainer config={seriesConfig} className="aspect-auto h-40 w-full" role="img" aria-labelledby={`s-${idx}`}>
            <LineChart data={b.points} margin={{ top: 6, right: 8, bottom: 0, left: 0 }}>
              <CartesianGrid strokeDasharray="2 4" vertical={false} />
              <XAxis dataKey="x" tickLine={false} axisLine={false} fontSize={10} interval="preserveStartEnd" minTickGap={24} />
              <YAxis tickLine={false} axisLine={false} fontSize={10} width={48} tickFormatter={(v: number) => (Math.abs(v) >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : Math.abs(v) >= 1e3 ? `${Math.round(v / 1e3)}k` : String(v))} />
              <ChartTooltip content={<ChartTooltipContent />} />
              <Line type="monotone" dataKey="y" name={b.yLabel} stroke="var(--color-y)" strokeWidth={2} dot={false} isAnimationActive={false} />
            </LineChart>
          </ChartContainer>
        </section>
      );
    case "hypotheses":
      return (
        <ol className="space-y-2">
          {b.items.map((h) => {
            const rec = h.id === b.recommended;
            const picked = actions.picked === h.id;
            return (
              <li key={h.id} data-tour={`hyp-${h.id}`} className={cn("rounded-lg border p-3", rec ? "border-primary" : "border-border", picked && "ring-2 ring-primary")}>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="type-caption font-semibold text-muted-foreground">#{h.rank}</span>
                  <h4 className="type-body font-semibold">{h.title}</h4>
                  {rec && <ToneBadge tone="reward">Recommended</ToneBadge>}
                  <ToneBadge tone={CONF_TONE[h.confidence]}>{h.confidence} confidence</ToneBadge>
                </div>
                <p className="mt-1 type-caption text-muted-foreground">{h.observation}</p>
                <p className="mt-1 type-caption">
                  <span className="font-medium">Variant:</span> {h.intervention} · <span className="font-medium">Expected:</span> {h.effect} (estimate)
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {actions.onPick && (
                    <Button size="xs" variant={picked ? "default" : "outline"} onClick={() => actions.onPick?.(h)} aria-pressed={picked}>
                      {picked ? <Check aria-hidden="true" /> : null}
                      {picked ? "Picked" : "Pick this"}
                    </Button>
                  )}
                  {actions.onDraft && (
                    <Button size="xs" variant="ghost" onClick={() => actions.onDraft?.(h)}>
                      Draft experiment
                    </Button>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      );
    case "scorecard": {
      const e = t.growth.lab.find((x) => x.id === b.expId);
      return e ? (
        <section className="rounded-lg border border-border p-3">
          <h4 className="mb-2 type-caption font-semibold">{e.name}</h4>
          <LabScorecard e={e} />
        </section>
      ) : (
        <p className="type-caption text-muted-foreground">That experiment no longer exists.</p>
      );
    }
    case "plan-diff":
      return (
        <div className="overflow-x-auto rounded-lg border border-border">
          <Table>
            <TableCaption className="caption-top px-3 pt-2 text-left type-caption font-semibold text-foreground">{b.title ?? "Change"}</TableCaption>
            <TableHeader>
              <TableRow>
                <TableHead scope="col">Item</TableHead>
                <TableHead scope="col">Today</TableHead>
                <TableHead scope="col">Proposed</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {b.rows.map((r) => (
                <TableRow key={r.path}>
                  <TableHead scope="row" className="font-normal">{r.path}</TableHead>
                  <TableCell className="text-muted-foreground line-through decoration-1">{r.before}</TableCell>
                  <TableCell className="font-medium">{r.after}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      );
    case "research":
      return (
        <section className="space-y-3 rounded-lg border border-border p-3">
          <div>
            <h4 className="type-caption font-semibold uppercase tracking-wide text-muted-foreground">Plan</h4>
            <ol className="mt-1 space-y-1">
              {b.plan.map((q, i) => (
                <li key={q} className="flex gap-2 type-caption">
                  <Check aria-hidden="true" className="mt-0.5 size-3.5 shrink-0 text-healthy-ink" />
                  <span>
                    {i + 1}. {q}
                  </span>
                </li>
              ))}
            </ol>
          </div>
          <div className="space-y-2">
            <h4 className="type-caption font-semibold uppercase tracking-wide text-muted-foreground">Brief</h4>
            {b.sections.map((s) => (
              <div key={s.heading}>
                <h5 className="type-body font-semibold">{s.heading}</h5>
                <p className="type-caption">
                  {s.text}{" "}
                  {s.cites.map((c) => {
                    const k = kbCard(c);
                    return k ? (
                      <a key={c} href={`#kb-${c}-${idx}`} className="text-primary underline-offset-2 hover:underline">
                        [{k.title}]
                      </a>
                    ) : null;
                  })}
                </p>
              </div>
            ))}
          </div>
          <div>
            <h4 className="type-caption font-semibold uppercase tracking-wide text-muted-foreground">Sources</h4>
            <ul className="mt-1 space-y-1">
              {[...new Set(b.sections.flatMap((s) => s.cites))].map((c) => {
                const k = kbCard(c);
                return k ? (
                  <li key={c} id={`kb-${c}-${idx}`} className="type-caption">
                    <span className="font-medium">{k.title}</span> · {k.source} · as of {k.asOf} · <ToneBadge tone={CONF_TONE[k.confidence]}>{k.confidence}</ToneBadge> <ToneBadge tone="neutral">Illustrative</ToneBadge>
                  </li>
                ) : null;
              })}
            </ul>
          </div>
          {actions.onSave && (
            <Button size="xs" variant="outline" disabled={actions.saved} onClick={() => actions.onSave?.(b.sections, b.plan)}>
              <BookmarkPlus aria-hidden="true" />
              {actions.saved ? "Saved to Playbook" : "Save to Playbook"}
            </Button>
          )}
        </section>
      );
    case "commands":
      return (
        <ul className="grid gap-1 sm:grid-cols-2">
          {b.items.map((c) => (
            <li key={c.name}>
              <button type="button" onClick={() => actions.onCommand?.(c.name)} className="w-full rounded-md border border-border px-2 py-1.5 text-left type-caption hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring">
                <span className="font-mono font-medium">
                  {c.name} {c.args}
                </span>
                <span className="block text-muted-foreground">{c.help}</span>
              </button>
            </li>
          ))}
        </ul>
      );
    case "memory":
      return <MemoryList cards={t.growth.memory.filter((c) => b.ids.includes(c.id))} />;
  }
}

export function MemoryList({ cards }: { cards: MemoryCard[] }) {
  return (
    <ul className="grid gap-2 sm:grid-cols-2">
      {cards.map((c) => (
        <li key={c.id} className="rounded-lg border border-border p-2">
          <div className="flex items-center justify-between gap-2">
            <span className="type-caption font-semibold">{c.title}</span>
            <ToneBadge tone={CONF_TONE[c.confidence]}>{c.confidence}</ToneBadge>
          </div>
          <p className="type-caption">{c.value}</p>
          <p className="type-caption text-muted-foreground">{c.source}</p>
        </li>
      ))}
    </ul>
  );
}
