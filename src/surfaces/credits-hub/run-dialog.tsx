import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { fmtNum } from "@/core/format";
import { balanceOf, blockMoment, buyTopUp, expectedRunCost, planOf, rateOf, runNow, topUpAllowed, packFor, type TenantState } from "@/core";
import { useMoney } from "@/ui/money";
import { usePay } from "@/surfaces/credits-hub/payments";
import type { Workflow } from "@/tenants/schema";
import type { RunFn } from "@/surfaces/credits-hub/page";

export function RunDialog({ t, personaId, workflow, onClose, run }: { t: TenantState; personaId: string; workflow: Workflow; onClose: () => void; run: RunFn }) {
  const { amountNum, fmtUsd, charged } = useMoney();
  const pay = usePay();
  const pack = t.pack;
  const hub = t.hub[personaId];
  const plan = planOf(pack, hub.planId);
  const need = expectedRunCost(pack, workflow);
  const rows = pack.meters.map((m) => {
    const bal = balanceOf(t.ledger, personaId, m.id);
    const n = need[m.id] ?? 0;
    return { m, need: n, bal, short: Math.max(0, n - bal), usd: n * m.pricePerUnit };
  });
  const dollars = rows.reduce((s, r) => s + r.usd, 0);
  const fitsRatio = Math.min(1, ...rows.filter((r) => r.need > 0).map((r) => r.bal / r.need));
  const fits = Math.floor(workflow.units * fitsRatio + 1e-9);
  const shortRows = rows.filter((r) => r.short > 0);
  const topUpPlan = shortRows.map((r) => {
    const choice = packFor(pack, r.m.id, r.short);
    const units = choice ? choice.pack.units * choice.count : 0;
    return { ...r, units, price: choice ? choice.pack.price * choice.count : 0, allowed: !!choice && topUpAllowed(pack, r.m.id, plan, "cockpit") };
  });
  const canTopAll = topUpPlan.length > 0 && topUpPlan.every((x) => x.allowed) && hub.card.status === "ok";
  const topUpTotal = topUpPlan.reduce((s, x) => s + x.price, 0);

  const doRun = (withTopUp: boolean) => {
    const apply = (base: TenantState) => {
      let next = base;
      if (withTopUp) for (const x of topUpPlan) next = buyTopUp(next, personaId, x.m.id, x.units).state;
      return runNow(next, personaId, workflow.id);
    };
    const preview = apply(t).result;
    const text =
      preview.status === "blocked"
        ? `${workflow.name} did not run. ${preview.reason ? blockMoment(pack, preview.reason, (n) => fmtUsd(n, 0)).headline + "." : ""}`
        : `${withTopUp ? `Topped up ${charged(topUpTotal)}. ` : ""}${workflow.name}: ${fmtNum(preview.done)} of ${fmtNum(preview.requested)} ${pack.workUnit.many} processed.`;
    if (withTopUp) pay({ usd: topUpTotal, label: `Top-up for ${workflow.name}`, apply: (s) => apply(s).state, okText: text });
    else run((s) => apply(s).state, text);
    onClose();
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Run {workflow.name}</DialogTitle>
          <DialogDescription>
            {fmtNum(workflow.units)} {pack.workUnit.many} · {workflow.steps.map((s) => rateOf(pack, s)?.label ?? s).join(" → ")}
          </DialogDescription>
        </DialogHeader>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead scope="col">Meter</TableHead>
              <TableHead scope="col" className="text-right">This run</TableHead>
              <TableHead scope="col" className="text-right">Balance</TableHead>
              <TableHead scope="col" className="text-right">List value</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.m.id}>
                <TableHead scope="row" className="font-medium">{r.m.label}</TableHead>
                <TableCell className="text-right tabular-nums">~{amountNum(r.m, r.need)}</TableCell>
                <TableCell className={r.short > 0 ? "text-right font-semibold tabular-nums text-red-700 dark:text-red-300" : "text-right tabular-nums"}>
                  {amountNum(r.m, r.bal)}
                </TableCell>
                <TableCell className="text-right tabular-nums">{fmtUsd(r.usd)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <div className="rounded-lg bg-muted p-3 text-sm">
          <div className="flex items-baseline justify-between">
            <span className="font-medium">Estimated run cost</span>
            <span className="text-lg font-semibold tabular-nums">{fmtUsd(dollars)}</span>
          </div>
          <p className="mt-1">
            {shortRows.length
              ? `Your balance covers about ${fmtNum(fits)} of ${fmtNum(workflow.units)} ${pack.workUnit.many}.`
              : `Your balance covers the full run.`}
          </p>
        </div>
        <DialogFooter className="gap-2 sm:justify-between">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <div className="flex flex-wrap gap-2">
            {shortRows.length > 0 && (
              <Button variant="outline" disabled={fits === 0} onClick={() => doRun(false)}>
                Run {fmtNum(fits)} {pack.workUnit.many}
              </Button>
            )}
            {shortRows.length > 0 ? (
              <Button disabled={!canTopAll} onClick={() => doRun(true)}>
                Top up {charged(topUpTotal)} and run all
              </Button>
            ) : (
              <Button onClick={() => doRun(false)}>Run now</Button>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
