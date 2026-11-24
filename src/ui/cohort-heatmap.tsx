import type { HeatRow } from "@/sim/series";
import { fmtPct } from "@/core/format";

/** Weekly signup cohorts down the side, weeks since signup across; each cell is the share still active. */
export function CohortHeatmap({ columns, rows, caption }: { columns: string[]; rows: HeatRow[]; caption: string }) {
  if (!rows.length) return <p className="type-body text-muted-foreground">{caption}: no cohorts yet.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-separate border-spacing-1 text-sm">
        <caption className="pb-2 text-left type-caption text-muted-foreground">{caption}</caption>
        <thead>
          <tr>
            <th scope="col" className="px-2 text-left type-caption font-medium text-muted-foreground">Signed up</th>
            <th scope="col" className="px-2 text-right type-caption font-medium text-muted-foreground">Accounts</th>
            {columns.map((c) => (
              <th key={c} scope="col" className="px-1 text-center type-caption font-medium text-muted-foreground">{c}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.label}>
              <th scope="row" className="px-2 text-left font-normal whitespace-nowrap">{r.label}</th>
              <td className="px-2 text-right num">{r.size}</td>
              {r.cells.map((v, i) => (
                <td
                  key={i}
                  className="h-8 min-w-11 rounded-md text-center type-caption font-medium num"
                  style={
                    v == null
                      ? undefined
                      : { background: `color-mix(in oklch, var(--chart-1) ${Math.round(6 + v * 49)}%, var(--card))`, color: "var(--foreground)" }
                  }
                >
                  {v == null ? "" : fmtPct(v)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
