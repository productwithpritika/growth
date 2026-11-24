import type { ReactNode } from "react";
import { Info } from "lucide-react";
import type { Insight } from "@/core/types";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ToneDot } from "@/ui/tone";
import { cn } from "@/lib/utils";

export function Stat({ label, value, sub, className }: { label: string; value: ReactNode; sub?: ReactNode; className?: string }) {
  return (
    <div className={cn("min-w-0", className)}>
      <div className="type-caption font-medium text-muted-foreground">{label}</div>
      <div className="mt-1 type-title num">{value}</div>
      {sub && <div className="mt-0.5 type-caption text-muted-foreground">{sub}</div>}
    </div>
  );
}

export function SectionTitle({ id, children, aside, as: As = "h2" }: { id?: string; children: ReactNode; aside?: ReactNode; as?: "h2" | "h3" }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-2">
      <As id={id} className="type-heading tracking-tight">
        {children}
      </As>
      {aside && <div className="type-caption text-muted-foreground">{aside}</div>}
    </div>
  );
}

export function InsightList({ items, empty }: { items: Insight[]; empty: string }) {
  if (!items.length) return <p className="type-body text-muted-foreground">{empty}</p>;
  return (
    <ul className="divide-y divide-border">
      {items.map((i) => (
        <li key={i.id} className="flex gap-3 py-2.5">
          <ToneDot tone={i.tone} />
          <div className="min-w-0 flex-1 type-body leading-snug">{i.title}</div>
          <span className="shrink-0 type-caption text-muted-foreground">{i.source}</span>
        </li>
      ))}
    </ul>
  );
}

export function StoredNote({ className }: { className?: string }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button type="button" className={cn("inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring", className)}>
          <Info className="size-3.5" aria-hidden="true" />
          Stored in this browser
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 text-sm">
        <p className="font-medium">Stored in this browser</p>
        <p className="mt-1.5 text-muted-foreground">
          Ledger entries, events, limits, experiments, approvals and Tenant Pack edits are kept in this browser only. They are not shared with other people, not synced to other browsers or devices, are visible to anyone
          using this browser profile, and are removed if browser data is cleared.
        </p>
      </PopoverContent>
    </Popover>
  );
}

export function UsageBar({ value, max, label, className }: { value: number; max: number; label: string; className?: string }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div role="img" aria-label={label} className={cn("h-1.5 w-full overflow-hidden rounded-full bg-muted", className)}>
      <div className="h-full rounded-full bg-info" style={{ width: `${pct}%` }} />
    </div>
  );
}
