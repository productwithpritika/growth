// Usage explainer (Phase 2 §2.2): breakdown by table, column, provider, model and member,
// Data Credits split from Actions, "Why did this cost that?" on every run, effective cost per
// verified contact with a gentle benchmark, 7/30/90-day range, CSV export and a read-only link.
import { useMemo, useState, useTransition, type ReactNode } from "react";
import { Link, useHref } from "react-router-dom";
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { Check, Copy, Download, HelpCircle, Link2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { EmptyState } from "@/components/states";
import { SectionTitle, Stat } from "@/ui/primitives";
import { ToneBadge } from "@/ui/tone";
import { useMoney } from "@/ui/money";
import { useHub } from "@/surfaces/credits-hub/hub-context";
import { breakdown, costPerVerified, createShare, dailySeries, earnBadge, fmtDate, fmtDateTime, memberName, primaryMeter, rateOf, revokeShare, runHistory, usageCsv, usdValue, type Dimension, type RunRecord } from "@/core";

const DIMS: { id: Dimension; label: string }[] = [
  { id: "table", label: "Table" },
  { id: "column", label: "Column" },
  { id: "provider", label: "Provider" },
  { id: "model", label: "Model" },
  { id: "member", label: "Member" },
];

export function downloadText(name: string, text: string, type = "text/csv") {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function UsageTab() {
  const { t, account, viewer } = useHub();
  const [days, setDays] = useState(30);
  const [dim, setDim] = useState<Dimension>("table");
  const [scope, setScope] = useState<"mine" | "all">(viewer.can("usage.all") ? "all" : "mine");
  const [pending, startTransition] = useTransition();
  const all = useMemo(() => runHistory(t, account, days), [t, account, days]);
  const runs = scope === "mine" ? all.filter((r) => r.member === viewer.id) : all;
  return (
    <UsageExplainer
      runs={runs}
      days={days}
      dim={dim}
      pending={pending}
      controls={
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <label htmlFor="usage-range" className="type-caption text-muted-foreground">
              Date range
            </label>
            <NativeSelect id="usage-range" size="sm" value={days} onChange={(e) => startTransition(() => setDays(Number(e.target.value)))}>
              <NativeSelectOption value={7}>Last 7 days</NativeSelectOption>
              <NativeSelectOption value={30}>Last 30 days</NativeSelectOption>
              <NativeSelectOption value={90}>Last 90 days</NativeSelectOption>
            </NativeSelect>
          </div>
          {account === "dev" && (
            <div className="space-y-1">
              <span id="usage-scope" className="type-caption text-muted-foreground">
                Whose usage
              </span>
              <ToggleGroup type="single" size="sm" variant="outline" aria-labelledby="usage-scope" value={scope} onValueChange={(v) => v && setScope(v as "mine" | "all")}>
                <ToggleGroupItem value="mine">Mine</ToggleGroupItem>
                <ToggleGroupItem value="all" disabled={!viewer.can("usage.all")}>
                  Workspace
                </ToggleGroupItem>
              </ToggleGroup>
            </div>
          )}
          <div className="space-y-1">
            <span id="usage-dim" className="type-caption text-muted-foreground">
              Break down by
            </span>
            <ToggleGroup type="single" size="sm" variant="outline" aria-labelledby="usage-dim" value={dim} onValueChange={(v) => v && startTransition(() => setDim(v as Dimension))} className="flex-wrap">
              {DIMS.map((d) => (
                <ToggleGroupItem key={d.id} value={d.id}>
                  {d.label}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </div>
          <div className="ml-auto flex flex-wrap gap-2">
            <Button size="sm" variant="outline" disabled={!runs.length} onClick={() => downloadText(`${t.pack.id}-usage-${days}d.csv`, usageCsv(t.pack, t.hub[account], runs))}>
              <Download aria-hidden="true" />
              Export CSV
            </Button>
            <ShareButton days={days} />
          </div>
        </div>
      }
    />
  );
}

function ShareButton({ days }: { days: number }) {
  const { t, account, viewer, act, run } = useHub();
  const base = useHref("/share");
  const [made, setMade] = useState<{ id: string; copied: boolean } | null>(null);
  const live = t.hub[account].shares.filter((s) => !s.revoked && new Date(s.expiresAt) > new Date(t.clock));
  const urlOf = (id: string) => `${window.location.origin}${base}/${id}`;
  const make = () => {
    const id = act((s) => createShare(s, account, days, viewer.actor), () => ({ ok: true, text: `Read-only link for the last ${days} days created. It expires in 14 days.` }));
    if (!id) return;
    setMade({ id, copied: false });
    navigator.clipboard?.writeText(urlOf(id)).then(
      () => setMade({ id, copied: true }),
      () => undefined,
    );
  };
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button size="sm" variant="outline" onClick={make}>
        {made?.copied ? <Check aria-hidden="true" /> : <Link2 aria-hidden="true" />}
        {made?.copied ? "Link copied" : "Share read-only link"}
      </Button>
      {made && (
        <Link to={`/share/${made.id}`} className="type-caption text-primary underline underline-offset-2">
          Open the shared view
        </Link>
      )}
      {live.length > 0 && (
        <Button size="sm" variant="ghost" onClick={() => run((s) => live.reduce((acc, l) => revokeShare(acc, account, l.id, viewer.actor).state, s), `${live.length} link${live.length === 1 ? "" : "s"} revoked. Anyone opening them now sees that access ended.`)}>
          Revoke {live.length} link{live.length === 1 ? "" : "s"}
        </Button>
      )}
    </div>
  );
}

/** The explainer body, shared by the Hub tab and the read-only share page. */
export function UsageExplainer({ runs, days, dim, controls, pending, readOnly }: { runs: RunRecord[]; days: number; dim: Dimension; controls?: ReactNode; pending?: boolean; readOnly?: boolean }) {
  const { t, account } = useHub();
  const { amountText, fmtUsd } = useMoney();
  const pack = t.pack;
  const hub = t.hub[account];
  const [open, setOpen] = useState<RunRecord | null>(null);
  const totals: Record<string, number> = {};
  for (const r of runs) for (const [m, v] of Object.entries(r.meters)) totals[m] = (totals[m] ?? 0) + v;
  const vc = costPerVerified(pack, runs);
  const rows = breakdown(pack, hub, runs, dim);
  const series = dailySeries(pack, runs, t.clock, days);
  const prim = primaryMeter(pack);
  const config = Object.fromEntries(pack.meters.map((m, i) => [m.id, { label: m.label, color: `var(--chart-${i + 1})` }])) satisfies ChartConfig;
  const [page, setPage] = useState(0);
  const perPage = 12;
  const shown = runs.slice(page * perPage, page * perPage + perPage);

  return (
    <div className="space-y-6" aria-busy={pending || undefined}>
      {controls}
      <section aria-label="Totals" className={`grid gap-3 sm:grid-cols-2 ${pack.meters.length > 1 ? "xl:grid-cols-4" : "xl:grid-cols-3"} ${pending ? "opacity-60" : ""}`}>
        {pack.meters.map((m, i) => (
          <Stat key={m.id} label={`${m.label} used`} value={amountText(m, totals[m.id] ?? 0, { label: false })} sub={i === 0 && pack.meters.length > 1 ? "Data and AI bought from marketplace providers" : i === 1 ? `${pack.company}'s own platform work: every step, call and sync` : m.hint} />
        ))}
        <Stat label="List value" value={fmtUsd(usdValue(pack, totals))} sub={`${runs.length} run${runs.length === 1 ? "" : "s"} in the last ${days} days`} />
        {vc.found > 0 || pack.meters.length === 1 ? (
          <Stat
            label={`Cost per ${pack.hub.verifiedNoun.one}`}
            value={vc.perVerified != null ? fmtUsd(vc.perVerified, 3) : "No verified results"}
            sub={
              vc.perVerified != null
                ? vc.benchmark
                  ? vc.perVerified <= vc.benchmark
                    ? `Below the ${fmtUsd(vc.benchmark, 2)} typical for ${vc.benchmarkLabel?.toLowerCase()}. Misses are free.`
                    : `${vc.benchmarkLabel} typically pay about ${fmtUsd(vc.benchmark, 2)}. Own keys and verifying before sending bring it down.`
                  : `${vc.verified.toLocaleString("en-US")} ${pack.hub.verifiedNoun.many} from ${fmtUsd(vc.spendUsd)} of lookups.`
                : "Add a contact column (work email, say) to see this."
            }
          />
        ) : null}
      </section>

      {runs.length === 0 ? (
        <EmptyState title="No usage in this range" description={`Nothing ran in the last ${days} days${readOnly ? "" : ". Add an enrichment column in Tables and it shows up here with what each row cost"}.`} />
      ) : (
        <>
          <section aria-labelledby="daily-title" className="space-y-2">
            <SectionTitle id="daily-title">{prim.label} per day</SectionTitle>
            <ChartContainer config={config} className="h-40 w-full" aria-label={`${prim.label} per day, last ${days} days`}>
              <BarChart data={series} margin={{ left: 4, right: 4, top: 4 }}>
                <CartesianGrid vertical={false} />
                <XAxis dataKey="day" tickLine={false} axisLine={false} minTickGap={24} tickFormatter={(d: string) => fmtDate(d)} />
                <YAxis width={44} tickLine={false} axisLine={false} />
                <ChartTooltip content={<ChartTooltipContent labelFormatter={(d) => fmtDate(String(d))} />} />
                <Bar dataKey={prim.id} fill={`var(--color-${prim.id})`} radius={2} isAnimationActive={false} />
              </BarChart>
            </ChartContainer>
          </section>

          <section aria-labelledby="bd-title" className={`space-y-2 ${pending ? "opacity-60" : ""}`}>
            <SectionTitle id="bd-title">By {DIMS.find((d) => d.id === dim)?.label.toLowerCase()}</SectionTitle>
            <div className="overflow-x-auto rounded-xl border border-border">
              <Table>
                <TableCaption className="sr-only">Usage by {dim}, highest value first</TableCaption>
                <TableHeader>
                  <TableRow>
                    <TableHead>{DIMS.find((d) => d.id === dim)?.label}</TableHead>
                    <TableHead className="text-right">Runs</TableHead>
                    <TableHead className="text-right">{pack.workUnit.many.replace(/^./, (c) => c.toUpperCase())}</TableHead>
                    <TableHead className="text-right">Found</TableHead>
                    {pack.meters.map((m) => (
                      <TableHead key={m.id} className="text-right">
                        {m.label}
                      </TableHead>
                    ))}
                    <TableHead className="text-right">Value</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => (
                    <TableRow key={r.key}>
                      <TableCell className="font-medium">{r.label}</TableCell>
                      <TableCell className="text-right num">{r.runs}</TableCell>
                      <TableCell className="text-right num">{r.rows.toLocaleString("en-US")}</TableCell>
                      <TableCell className="text-right num">{r.found.toLocaleString("en-US")}</TableCell>
                      {pack.meters.map((m) => (
                        <TableCell key={m.id} className="text-right num">
                          {amountText(m, r.meters[m.id] ?? 0, { label: false })}
                        </TableCell>
                      ))}
                      <TableCell className="text-right num">{fmtUsd(r.usd)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </section>

          <section aria-labelledby="runs-title" className="space-y-2">
            <SectionTitle id="runs-title" aside={<span className="type-caption text-muted-foreground">Newest first</span>}>
              Runs
            </SectionTitle>
            <ul className="divide-y divide-border rounded-xl border border-border bg-card">
              {shown.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2.5">
                  <div className="min-w-0 flex-1">
                    <div className="type-body font-medium">
                      {r.table} <span className="font-normal text-muted-foreground">· {r.columns.map((c) => c.label).join(", ")}</span>
                    </div>
                    <div className="type-caption text-muted-foreground">
                      {fmtDateTime(r.ts)} · {memberName(hub, r.member)} · {r.done.toLocaleString("en-US")} of {r.rows.toLocaleString("en-US")} {pack.workUnit.many}
                    </div>
                  </div>
                  {r.status !== "ok" && r.status !== "done" && <ToneBadge tone={r.status === "paused" || r.status === "stopped" ? "watch" : "info"}>{r.status === "stopped" ? "Stopped early" : r.status[0].toUpperCase() + r.status.slice(1)}</ToneBadge>}
                  <span className="num type-body">{pack.meters.map((m) => amountText(m, r.meters[m.id] ?? 0)).join(" · ")}</span>
                  <Button size="sm" variant="ghost" onClick={() => setOpen(r)} aria-label={`Why did ${r.table} on ${fmtDate(r.ts)} cost this?`}>
                    <HelpCircle aria-hidden="true" />
                    Why this cost
                  </Button>
                </li>
              ))}
            </ul>
            {runs.length > perPage && (
              <div className="flex items-center justify-between gap-2 type-caption text-muted-foreground">
                <span>
                  {page * perPage + 1}–{Math.min(runs.length, (page + 1) * perPage)} of {runs.length}
                </span>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
                    Newer
                  </Button>
                  <Button size="sm" variant="outline" disabled={(page + 1) * perPage >= runs.length} onClick={() => setPage((p) => p + 1)}>
                    Older
                  </Button>
                </div>
              </div>
            )}
          </section>
        </>
      )}
      <WhyDrawer run={open} onClose={() => setOpen(null)} readOnly={readOnly} />
    </div>
  );
}

function WhyDrawer({ run: r, onClose, readOnly }: { run: RunRecord | null; onClose: () => void; readOnly?: boolean }) {
  const { t, account, viewer, act } = useHub();
  const { amountText, fmtUsd } = useMoney();
  const pack = t.pack;
  const [reported, setReported] = useState(false);
  return (
    <Sheet open={!!r} onOpenChange={(v) => !v && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
        {r && (
          <>
            <SheetHeader>
              <SheetTitle>Why did this cost that?</SheetTitle>
              <SheetDescription>
                {r.table} · {fmtDateTime(r.ts)} · run by {memberName(t.hub[account], r.member)}
              </SheetDescription>
            </SheetHeader>
            <div className="space-y-5 px-4 pb-6">
              <p className="type-body">
                {r.done.toLocaleString("en-US")} {pack.workUnit.many} ran{r.done < r.rows ? ` of the ${r.rows.toLocaleString("en-US")} requested` : ""}, costing {pack.meters.map((m) => amountText(m, r.meters[m.id] ?? 0)).join(" and ")} ({fmtUsd(usdValue(pack, r.meters))} at list price).
              </p>
              {r.columns.map((c) => {
                const item = rateOf(pack, c.stepId);
                return (
                  <section key={c.stepId} aria-label={c.label} className="space-y-2 rounded-lg border border-border p-3">
                    <div className="flex items-baseline justify-between gap-2">
                      <h3 className="type-body font-semibold">{c.label}</h3>
                      <span className="type-caption text-muted-foreground">
                        {c.provider} · {c.model}
                      </span>
                    </div>
                    <dl className="grid grid-cols-2 gap-x-4 gap-y-1 type-body">
                      <dt className="text-muted-foreground">Rows run</dt>
                      <dd className="text-right num">{c.done.toLocaleString("en-US")}</dd>
                      <dt className="text-muted-foreground">Per row</dt>
                      <dd className="text-right num">
                        {pack.meters
                          .filter((m) => (item?.costs[m.id] ?? 0) > 0)
                          .map((m) => amountText(m, item?.costs[m.id] ?? 0))
                          .join(" + ") || "Free"}
                      </dd>
                      <dt className="text-muted-foreground">Found</dt>
                      <dd className="text-right num">{c.found.toLocaleString("en-US")}</dd>
                      <dt className="text-muted-foreground">Not found</dt>
                      <dd className="text-right num">
                        {c.notFound.toLocaleString("en-US")}
                        {item?.chargeOnHit ? ` · no ${pack.meters[0].label} charged` : ""}
                      </dd>
                      {c.contact && (
                        <>
                          <dt className="text-muted-foreground">Verified</dt>
                          <dd className="text-right num">{c.verified.toLocaleString("en-US")}</dd>
                        </>
                      )}
                      <dt className="text-muted-foreground">Retries</dt>
                      <dd className="text-right num">{c.retries.toLocaleString("en-US")} · not charged twice</dd>
                      {pack.meters.map((m) => (
                        <div key={m.id} className="contents">
                          <dt className="text-muted-foreground">{m.label}</dt>
                          <dd className="text-right num font-medium">{amountText(m, c.meters[m.id] ?? 0, { label: false })}</dd>
                        </div>
                      ))}
                    </dl>
                  </section>
                );
              })}
              <section aria-label="Holds" className="space-y-1 rounded-lg bg-muted/50 p-3 type-body">
                <h3 className="font-semibold">Holds</h3>
                {Object.keys(r.held).length ? (
                  pack.meters
                    .filter((m) => r.held[m.id] != null)
                    .map((m) => (
                      <p key={m.id}>
                        {amountText(m, r.held[m.id])} held before the run; {amountText(m, r.meters[m.id] ?? 0)} used; {amountText(m, r.released[m.id] ?? 0)} released back.
                      </p>
                    ))
                ) : (
                  <p className="text-muted-foreground">No hold: this run was charged row by row as it went.</p>
                )}
              </section>
              {!readOnly && (
                <div className="space-y-1">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={reported}
                    onClick={() => {
                      act((s) => earnBadge(s, account, "bad-record", viewer.actor), () => ({ ok: true, text: "Thanks. The record goes to the provider for review; if it's wrong, its credits come back." }));
                      setReported(true);
                    }}
                  >
                    <Copy aria-hidden="true" />
                    {reported ? "Reported" : "Report a bad record"}
                  </Button>
                  <p className="type-caption text-muted-foreground">Wrong e-mail or a stale title? Reports go to the provider and credit back confirmed misses.</p>
                </div>
              )}
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
