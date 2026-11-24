import { useState } from "react";
import type { GrantSource, LedgerEntry, LedgerKind } from "@/core/types";
import type { TenantPack } from "@/tenants/schema";
import { amountNum, fmtDate, fmtDateTime } from "@/core/format";
import { meterOf } from "@/core/pack";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ToneBadge } from "@/ui/tone";
import type { Tone } from "@/core/types";
import { cn } from "@/lib/utils";

export const LEDGER_FILTERS: { id: string; label: string; kinds: LedgerKind[] }[] = [
  { id: "grant", label: "Grant", kinds: ["grant"] },
  { id: "debit", label: "Debit", kinds: ["debit"] },
  { id: "hold", label: "Hold", kinds: ["hold", "release"] },
  { id: "rollover", label: "Rollover", kinds: ["rollover"] },
  { id: "expiry", label: "Expiry", kinds: ["expiry"] },
  { id: "reversal", label: "Reversal", kinds: ["reversal"] },
];

export const KIND_TONE: Record<LedgerKind, Tone> = {
  grant: "info",
  debit: "neutral",
  hold: "watch",
  release: "neutral",
  rollover: "info",
  expiry: "atRisk",
  reversal: "blocked",
};

export const SOURCE_LABEL: Record<GrantSource, string> = { plan: "plan", rollover: "rollover", topup: "top-up", reward: "reward", promo: "promo" };
const SOURCE_TONE: Record<GrantSource, Tone> = { plan: "info", rollover: "info", topup: "healthy", reward: "reward", promo: "reward" };

export interface LedgerTableProps {
  pack: TenantPack;
  entries: LedgerEntry[];
  accountName?: (id: string) => string;
  pageSize?: number;
  dense?: boolean;
  caption?: string;
  /** Adds a Reverse action to entries that can be corrected. */
  onReverse?: (e: LedgerEntry) => void;
  reversed?: Set<string>;
}

const REVERSIBLE: LedgerKind[] = ["grant", "debit", "rollover", "expiry"];

/** The ledger, newest first, filterable by kind; each row carries its reason code, actor and idempotency key. */
export function LedgerTable({ pack, entries, accountName = (x) => x, pageSize = 40, dense, caption = "Credit ledger, newest first", onReverse, reversed }: LedgerTableProps) {
  const [on, setOn] = useState<string[]>([]);
  const [limit, setLimit] = useState(pageSize);
  const kinds = new Set(LEDGER_FILTERS.filter((f) => on.includes(f.id)).flatMap((f) => f.kinds));
  const rows = entries.filter((e) => !on.length || kinds.has(e.kind)).slice().reverse();
  const toggle = (id: string) => {
    setOn((xs) => (xs.includes(id) ? xs.filter((x) => x !== id) : [...xs, id]));
    setLimit(pageSize);
  };
  return (
    <div className="space-y-3">
      <div role="group" aria-label="Filter by entry type" className="flex flex-wrap gap-1.5">
        <Button size="xs" variant={on.length === 0 ? "default" : "outline"} aria-pressed={on.length === 0} onClick={() => setOn([])}>
          All
        </Button>
        {LEDGER_FILTERS.map((f) => (
          <Button key={f.id} size="xs" variant={on.includes(f.id) ? "default" : "outline"} aria-pressed={on.includes(f.id)} onClick={() => toggle(f.id)}>
            {f.label}
            <span className="num opacity-80">{entries.filter((e) => f.kinds.includes(e.kind)).length}</span>
          </Button>
        ))}
      </div>
      <Table>
        <TableCaption className="sr-only">{caption}</TableCaption>
        <TableHeader>
          <TableRow>
            {!dense && <TableHead scope="col">#</TableHead>}
            <TableHead scope="col">Time</TableHead>
            {!dense && <TableHead scope="col">Account</TableHead>}
            <TableHead scope="col">Entry</TableHead>
            <TableHead scope="col">Note</TableHead>
            <TableHead scope="col" className="text-right">Amount</TableHead>
            <TableHead scope="col" className="text-right">Balance</TableHead>
            {!dense && <TableHead scope="col">Expires</TableHead>}
            {!dense && <TableHead scope="col">Hash</TableHead>}
            {onReverse && <TableHead scope="col"><span className="sr-only">Actions</span></TableHead>}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.slice(0, limit).map((e) => {
            const m = meterOf(pack, e.meter);
            const isReversed = reversed?.has(e.id);
            return (
              <TableRow key={e.id}>
                {!dense && <TableHead scope="row" className="font-normal num">{e.seq}</TableHead>}
                <TableCell className="whitespace-nowrap num">{fmtDateTime(e.ts)}</TableCell>
                {!dense && <TableCell>{accountName(e.account)}</TableCell>}
                <TableCell>
                  <div className="flex flex-wrap items-center gap-1">
                    <ToneBadge tone={KIND_TONE[e.kind]}>{e.kind}</ToneBadge>
                    {e.source && e.kind !== "rollover" && <ToneBadge tone={SOURCE_TONE[e.source]}>{SOURCE_LABEL[e.source]}</ToneBadge>}
                    {isReversed && <ToneBadge tone="neutral">reversed</ToneBadge>}
                  </div>
                </TableCell>
                <TableCell className="max-w-[280px]">
                  <div className="truncate" title={e.note}>{e.note}</div>
                  {!dense && (
                    <div className="truncate font-mono type-caption text-muted-foreground" title={`reason ${e.reason} · actor ${e.actor} · key ${e.idempotencyKey}${e.reverses ? ` · reverses ${e.reverses}` : ""}${e.lotId ? ` · lot ${e.lotId}` : ""}`}>
                      {e.reason} · {e.actor}
                      {e.reverses ? ` · ↺ ${e.reverses}` : ""}
                    </div>
                  )}
                </TableCell>
                <TableCell className={cn("text-right font-medium whitespace-nowrap num", e.amount > 0 && "text-healthy-ink")}>
                  {e.amount > 0 ? "+" : e.amount < 0 ? "−" : ""}
                  {amountNum(m, Math.abs(e.amount))} {pack.meters.length > 1 && <span className="type-caption font-normal text-muted-foreground">{m.label}</span>}
                </TableCell>
                <TableCell className="text-right whitespace-nowrap num">{amountNum(m, e.balance)}</TableCell>
                {!dense && <TableCell className="whitespace-nowrap num">{e.expiresAt ? fmtDate(e.expiresAt) : "—"}</TableCell>}
                {!dense && <TableCell className="font-mono type-caption" title={`prev ${e.prev} · key ${e.idempotencyKey}`}>{e.hash}</TableCell>}
                {onReverse && (
                  <TableCell className="text-right">
                    {REVERSIBLE.includes(e.kind) && !isReversed && e.amount !== 0 && (
                      <Button size="xs" variant="ghost" onClick={() => onReverse(e)} aria-label={`Reverse entry ${e.seq}`}>
                        Reverse
                      </Button>
                    )}
                  </TableCell>
                )}
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
      {rows.length === 0 && <p className="type-body text-muted-foreground">No entries of this type.</p>}
      {rows.length > limit && (
        <Button variant="ghost" size="sm" onClick={() => setLimit((l) => l + pageSize)}>
          Show {Math.min(pageSize, rows.length - limit)} more
        </Button>
      )}
    </div>
  );
}
