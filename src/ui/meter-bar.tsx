import type { Meter } from "@/tenants/schema";
import { useMoney } from "@/ui/money";
import { cn } from "@/lib/utils";

export interface MeterBarProps {
  meter: Meter;
  used: number;
  held: number;
  remaining: number;
  expiring: number;
  /** Hide the legend under the bar (the values stay in the accessible name). */
  compact?: boolean;
  className?: string;
}

const SEGMENTS = [
  { key: "used", label: "Used", swatch: "bg-foreground/80" },
  { key: "held", label: "Held", swatch: "bg-info [background-image:repeating-linear-gradient(135deg,transparent_0_3px,rgb(255_255_255/0.45)_3px_6px)]" },
  { key: "free", label: "Remaining", swatch: "bg-healthy" },
  { key: "expiring", label: "Expiring soon", swatch: "bg-watch" },
] as const;

/** Used · held · remaining · expiring-soon, as one bar over everything available this cycle. */
export function MeterBar({ meter, used, held, remaining, expiring, compact, className }: MeterBarProps) {
  const { amountText, amountNum } = useMoney();
  const exp = Math.min(Math.max(0, expiring), Math.max(0, remaining));
  const values = { used: Math.max(0, used), held: Math.max(0, held), free: Math.max(0, remaining - exp), expiring: exp };
  const total = values.used + values.held + values.free + values.expiring;
  const label = `${meter.label}: ${SEGMENTS.map((s) => `${s.label.toLowerCase()} ${amountText(meter, values[s.key])}`).join(", ")}`;
  return (
    <div className={cn("space-y-1.5", className)}>
      <div role="img" aria-label={label} className="flex h-2.5 w-full overflow-hidden rounded-full bg-muted">
        {SEGMENTS.map((s) => {
          const pct = total > 0 ? (values[s.key] / total) * 100 : 0;
          return pct > 0 ? <div key={s.key} className={cn("h-full first:rounded-l-full last:rounded-r-full", s.swatch)} style={{ width: `${pct}%` }} /> : null;
        })}
      </div>
      {!compact && (
        <dl className="flex flex-wrap gap-x-4 gap-y-1 type-caption text-muted-foreground">
          {SEGMENTS.map((s) => (
            <div key={s.key} className="flex items-center gap-1.5">
              <span aria-hidden="true" className={cn("size-2 rounded-sm", s.swatch)} />
              <dt>{s.label}</dt>
              <dd className="font-medium text-foreground num">{amountNum(meter, values[s.key])}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}
