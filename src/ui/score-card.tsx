import type { ScoreRow } from "@/sim/series";
import { fmtPct } from "@/core/format";
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

/** Milestones reached by day 1, 3 and 7, with each cell's bar showing the share. */
export function ScoreCard({ title, size, rows }: { title: string; size: number; rows: ScoreRow[] }) {
  if (size === 0 || rows.length === 0) return <p className="type-body text-muted-foreground">{title}: no signups in this window yet.</p>;
  return (
    <Table>
      <TableCaption className="text-left">{`${title} · ${size} accounts`}</TableCaption>
      <TableHeader>
        <TableRow>
          <TableHead scope="col">Milestone</TableHead>
          {(["D1", "D3", "D7"] as const).map((d) => (
            <TableHead key={d} scope="col" className="w-24 text-right">{d}</TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((r) => (
          <TableRow key={r.metric}>
            <TableHead scope="row" className="font-normal">{r.metric}</TableHead>
            {[r.d1, r.d3, r.d7].map((v, i) => (
              <TableCell key={i} className="text-right">
                <div className="flex flex-col items-end gap-1">
                  <span className="font-medium num">{fmtPct(v)}</span>
                  <span aria-hidden="true" className="h-1 w-16 overflow-hidden rounded-full bg-muted">
                    <span className="block h-full rounded-full bg-primary" style={{ width: `${Math.round(v * 100)}%` }} />
                  </span>
                </div>
              </TableCell>
            ))}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
