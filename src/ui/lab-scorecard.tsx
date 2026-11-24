import type { LabExperiment, Verdict } from "@/growth/types";
import { CHECKPOINTS, scorecard, type Checkpoint, type Interval, type ScoreLine } from "@/growth/lab";
import { fmtNum, fmtPct, fmtUsd } from "@/core/format";
import { ToneBadge } from "@/ui/tone";
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";

export const VERDICT_TONE: Record<Verdict, "neutral" | "info" | "healthy" | "watch" | "blocked"> = { "Too early": "neutral", Directional: "info", Ship: "healthy", Hold: "watch", Kill: "blocked" };
const COL: Record<Checkpoint, { label: string; sub: string }> = {
  1: { label: "D1", sub: "Leading · never a winner" },
  3: { label: "D3", sub: "Directional" },
  7: { label: "D7", sub: "Decision grade" },
};

function cell(l: ScoreLine, iv: Interval | undefined) {
  if (!iv) return <span className="text-muted-foreground">Not yet</span>;
  const f = (v: number) => (l.kind === "rate" ? fmtPct(v, 1) : l.kind === "usd" ? fmtUsd(v, v < 1 ? 4 : 2) : l.kind === "count" ? fmtNum(v) : fmtNum(v, 1));
  if (l.kind === "count") return <span className="num">{fmtNum(iv.control + iv.variant)}</span>;
  const sig = iv.lo > 0 || iv.hi < 0;
  return (
    <div className="flex flex-col items-end gap-0.5">
      <span className="num font-medium">
        {f(iv.control)} → {f(iv.variant)}
      </span>
      <span className={cn("type-caption num", sig ? (iv.diff > 0 ? "text-healthy-ink" : "text-blocked-ink") : "text-muted-foreground")}>
        {iv.lift >= 0 ? "+" : ""}
        {fmtPct(iv.lift)} ({fmtPct(iv.liftLo)} to {fmtPct(iv.liftHi)})
      </span>
    </div>
  );
}

/** D1, D3 and D7 columns with intervals, always-on guardrails and verdict chips. `preview` shows the layout before any data. */
export function LabScorecard({ e, preview = false }: { e: LabExperiment; preview?: boolean }) {
  const sc = scorecard(e);
  const groups: { title: string; lines: ScoreLine[] }[] = [
    { title: "Leading (D1)", lines: sc.leading },
    { title: "Behaviour (D3)", lines: sc.directional },
    { title: "Decision (D7)", lines: sc.decision },
  ];
  const verdictAt = (d: Checkpoint): Verdict => (sc.daysRun < d ? "Too early" : d === 1 ? "Too early" : d === 3 ? "Directional" : sc.verdict);
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <ToneBadge tone={VERDICT_TONE[sc.verdict]}>{sc.verdict}</ToneBadge>
        <span className="type-caption text-muted-foreground">{preview ? "Layout preview: cells fill in as days pass." : sc.reason}</span>
      </div>
      <div className="overflow-x-auto">
        <Table className="min-w-[560px]">
          <TableCaption className="sr-only">Scorecard for {e.name}: control then variant, with the relative lift and its 95% interval</TableCaption>
          <TableHeader>
            <TableRow>
              <TableHead scope="col">Metric</TableHead>
              {CHECKPOINTS.map((d) => (
                <TableHead key={d} scope="col" className="text-right">
                  <div>{COL[d].label}</div>
                  <div className="type-caption font-normal text-muted-foreground">{COL[d].sub}</div>
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {groups.map((g) => (
              <GroupRows key={g.title} title={g.title} lines={g.lines} preview={preview} />
            ))}
            <TableRow>
              <TableHead scope="rowgroup" colSpan={4} className="bg-muted/50 type-caption font-semibold uppercase tracking-wide">
                Guardrails (always shown)
              </TableHead>
            </TableRow>
            {(sc.guards[1] ?? sc.guards[3] ?? sc.guards[7] ?? defaultGuards(e)).map((g0) => (
              <TableRow key={g0.id}>
                <TableHead scope="row" className="font-normal">
                  {g0.label}
                  <div className="type-caption text-muted-foreground">Stop-loss if worse by more than {g0.limit} points</div>
                </TableHead>
                {CHECKPOINTS.map((d) => {
                  const r = preview ? undefined : sc.guards[d]?.find((x) => x.id === g0.id);
                  return (
                    <TableCell key={d} className="text-right">
                      {r ? (
                        <span className={cn("num", r.breached ? "font-semibold text-blocked-ink" : "")}>
                          {r.control.toFixed(1)} → {r.variant.toFixed(1)}
                          {r.unit === "%" ? "%" : ""}
                          {r.breached ? " · breach" : ""}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">Not yet</span>
                      )}
                    </TableCell>
                  );
                })}
              </TableRow>
            ))}
            <TableRow>
              <TableHead scope="row" className="font-normal">Verdict</TableHead>
              {CHECKPOINTS.map((d) => (
                <TableCell key={d} className="text-right">
                  <ToneBadge tone={VERDICT_TONE[preview ? "Too early" : verdictAt(d)]}>{preview ? (d === 7 ? "Ship · Hold · Kill" : d === 3 ? "Directional" : "Too early") : verdictAt(d)}</ToneBadge>
                </TableCell>
              ))}
            </TableRow>
          </TableBody>
        </Table>
      </div>
      {!preview && (
        <p className="type-caption text-muted-foreground">
          Sample ratio {sc.srm.ok ? "OK" : "mismatch: check assignment before reading results"} · {fmtNum(sc.srm.control)} control, {fmtNum(sc.srm.variant)} variant (p = {sc.srm.p.toFixed(3)})
        </p>
      )}
      {!preview && sc.segments.length > 0 && (
        <div>
          <h4 className="type-caption font-semibold uppercase tracking-wide text-muted-foreground">Segment cuts at D7</h4>
          <ul className="mt-1 grid gap-1 sm:grid-cols-3">
            {sc.segments.map((s) => (
              <li key={s.label} className="rounded-md border border-border px-2 py-1.5 type-caption">
                <span className="font-medium">{s.label}</span>: {s.lift >= 0 ? "+" : ""}
                {fmtPct(s.lift)} <span className="text-muted-foreground">({fmtPct(s.lo)} to {fmtPct(s.hi)})</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function defaultGuards(e: LabExperiment) {
  return e.guardrails.map((g) => ({ id: g.id, label: g.label, limit: g.maxWorsePts, control: 0, variant: 0, unit: "", worsePts: 0, breached: false }));
}

function GroupRows({ title, lines, preview }: { title: string; lines: ScoreLine[]; preview: boolean }) {
  return (
    <>
      <TableRow>
        <TableHead scope="rowgroup" colSpan={4} className="bg-muted/50 type-caption font-semibold uppercase tracking-wide">
          {title}
        </TableHead>
      </TableRow>
      {lines.map((l) => (
        <TableRow key={l.id}>
          <TableHead scope="row" className="font-normal">{l.label}</TableHead>
          {CHECKPOINTS.map((d) => (
            <TableCell key={d} className="text-right">
              {d in l.at ? (preview ? <span className="text-muted-foreground">Fills on {COL[d].label}</span> : cell(l, l.at[d])) : <span className="text-muted-foreground" aria-label="Not measured at this checkpoint">—</span>}
            </TableCell>
          ))}
        </TableRow>
      ))}
    </>
  );
}
