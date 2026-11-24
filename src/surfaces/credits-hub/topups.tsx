// Top-ups and auto top-up (Phase 2 §2.5): packs per meter with a falling price per credit,
// validity, a custom amount slider, tax line and strong authentication where the region needs
// it. Auto top-up has a threshold, amount, monthly cap, behaviour at the cap, failure handling
// and an "I changed my mind" pause. Receipts land in Billing and in the ledger as top-ups.
import { useState, type FormEvent } from "react";
import { Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { SectionTitle } from "@/ui/primitives";
import { ToneBadge } from "@/ui/tone";
import { useMoney } from "@/ui/money";
import { RecurringConsent, TaxNote, usePay } from "@/surfaces/credits-hub/payments";
import { useHub } from "@/surfaces/credits-hub/hub-context";
import {
  buyCustomTopUp,
  buyTopUp,
  cardLabel,
  changedMyMind,
  copy,
  customTopUpPrice,
  cycleOf,
  fmtDate,
  fmtDateTime,
  meterOf,
  packFor,
  packsFor,
  planOf,
  recordConsent,
  refundableAutoTopUp,
  resumeAutoTopUp,
  saveAutoTopUp,
  topUpAllowed,
  topUpSpend,
} from "@/core";

export function TopUpsTab() {
  const { t, account, viewer } = useHub();
  const { amountText, price, suffix, charged, region } = useMoney();
  const pay = usePay();
  const pack = t.pack;
  const hub = t.hub[account];
  const plan = planOf(pack, hub.planId);
  const payable = hub.card.status === "ok" || hub.backupCard?.status === "ok";
  const { start } = cycleOf(t);
  const receipts = hub.charges.filter((c) => c.meter).slice().reverse();

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_400px]">
      <section aria-labelledby="packs-title" className="min-w-0 space-y-4">
        <SectionTitle id="packs-title" aside={<span className="type-caption text-muted-foreground">Paid with {hub.card.status === "ok" ? cardLabel(hub.card) : hub.backupCard ? `backup ${cardLabel(hub.backupCard)}` : "no valid card"}</span>}>
          {copy(pack, "topups.title", "Top-up packs")}
        </SectionTitle>
        {pack.meters.map((m) => {
          const allowed = topUpAllowed(pack, m.id, plan, "cockpit");
          const packs = packsFor(pack, m.id).slice().sort((a, b) => a.units - b.units);
          const base = packs[0] ? packs[0].price / packs[0].units : 0;
          return (
            <div key={m.id} className="space-y-2">
              {pack.meters.length > 1 && <h3 className="type-body font-semibold">{m.label}</h3>}
              {!packs.length ? (
                <p className="type-body text-muted-foreground">{pack.company} doesn't sell {m.label} packs.</p>
              ) : (
                <ul className="grid gap-3 sm:grid-cols-2 2xl:grid-cols-4">
                  {packs.map((p) => {
                    const per = p.price / p.units;
                    const save = base > 0 ? Math.round((1 - per / base) * 100) : 0;
                    return (
                      <li key={p.id} className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4">
                        <div className="space-y-1">
                          <div className="flex items-start justify-between gap-2">
                            <div className="type-title">{amountText(m, p.units)}</div>
                            {save > 0 && <ToneBadge tone="healthy">Save {save}%</ToneBadge>}
                          </div>
                          <p className="type-caption text-muted-foreground">
                            {m.valueType === "currency" ? "Added to your balance" : `${price(per, per < 0.1 ? 4 : 2)} each`}
                            {p.validityDays ? ` · valid ${p.validityDays} days` : " · no expiry"}
                          </p>
                        </div>
                        <div className="mt-auto flex items-center justify-between gap-2">
                          <span className="type-heading num">
                            {price(p.price)}
                            <span className="ml-1 type-caption font-normal text-muted-foreground">{suffix}</span>
                          </span>
                          <Button size="sm" disabled={!allowed || !payable} aria-label={`Buy ${amountText(m, p.units)}`} onClick={() => pay({ usd: p.price, label: `${amountText(m, p.units)} top-up`, apply: (s) => buyTopUp(s, account, m.id, p.units).state, okText: `${amountText(m, p.units)} added for ${charged(p.price)}. Receipt in Billing.` })}>
                            Buy
                          </Button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
              {packs.length > 0 && allowed && payable && <CustomAmount meterId={m.id} />}
              {(!allowed || !payable) && packs.length > 0 && <p className="type-caption">{!allowed ? `${m.label} top-ups aren't available on ${plan.name}.` : "Add a valid card in Billing to buy."}</p>}
            </div>
          );
        })}
        <TaxNote />
        <section aria-labelledby="receipts-title" className="space-y-2">
          <SectionTitle id="receipts-title">Receipts</SectionTitle>
          {receipts.length ? (
            <div className="overflow-x-auto rounded-xl border border-border">
              <Table>
                <TableCaption className="sr-only">Top-up receipts, newest first. Each one is a ledger grant tagged top-up.</TableCaption>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>What</TableHead>
                    <TableHead>Ledger</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {receipts.map((c) => {
                    const entry = t.ledger.find((e) => e.idempotencyKey === `topup:${c.id}`);
                    return (
                      <TableRow key={c.id}>
                        <TableCell className="num whitespace-nowrap">{fmtDateTime(c.ts)}</TableCell>
                        <TableCell>
                          {c.description}
                          {c.reason && <div className="type-caption text-muted-foreground">{c.reason}</div>}
                        </TableCell>
                        <TableCell className="type-caption text-muted-foreground">{entry ? `grant · top-up · ${entry.id}` : c.status === "failed" ? "No entry: not charged" : "—"}</TableCell>
                        <TableCell className="text-right num">{charged(c.amount)}</TableCell>
                        <TableCell>
                          <ToneBadge tone={c.status === "paid" || c.status === "recovered" ? "healthy" : c.status === "refunded" ? "neutral" : "blocked"}>{c.status === "paid" ? "Paid" : c.status === "recovered" ? "Recovered" : c.status === "refunded" ? "Refunded" : "Declined"}</ToneBadge>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          ) : (
            <p className="type-body text-muted-foreground">No top-ups yet. Receipts show up here and in Billing as soon as you buy one.</p>
          )}
          <p className="type-caption text-muted-foreground">This cycle: {charged(topUpSpend(hub, start))} on top-ups{region.tax.display !== "exclusive" ? "" : " before tax"}.</p>
        </section>
      </section>
      {viewer.can("auto") ? <AutoTopUp /> : null}
    </div>
  );
}

function CustomAmount({ meterId }: { meterId: string }) {
  const { t, account, viewer } = useHub();
  const { amountText, price, charged } = useMoney();
  const pay = usePay();
  const m = meterOf(t.pack, meterId);
  const packs = packsFor(t.pack, meterId).slice().sort((a, b) => a.units - b.units);
  const min = packs[0]?.units ?? 1;
  const max = (packs[packs.length - 1]?.units ?? 100) * 2;
  const step = Math.max(1, Math.round(min / 2));
  const [units, setUnits] = useState(Math.round((min + max) / 4 / step) * step);
  const q = customTopUpPrice(t.pack, meterId, units);
  if (!q) return null;
  return (
    <div className="space-y-2 rounded-xl border border-dashed border-border p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <Label htmlFor={`custom-${meterId}`}>Custom amount</Label>
        <span className="type-body num">
          <span className="font-semibold">{amountText(m, units)}</span> for {price(q.usd)} · {price(q.perUnit, q.perUnit < 0.1 ? 4 : 2)} each
        </span>
      </div>
      <Slider id={`custom-${meterId}`} min={min} max={max} step={step} value={[units]} onValueChange={(v) => setUnits(v[0])} aria-label={`Custom ${m.label} amount`} aria-valuetext={amountText(m, units)} />
      <div className="flex items-center justify-between gap-2">
        <span className="type-caption text-muted-foreground">Priced at the per-credit rate of the largest pack it reaches.</span>
        <Button size="sm" variant="outline" onClick={() => pay({ usd: q.usd, label: `${amountText(m, units)} top-up`, apply: (s) => buyCustomTopUp(s, account, meterId, units, viewer.actor).state, okText: `${amountText(m, units)} added for ${charged(q.usd)}.` })}>
          Buy {amountText(m, units)}
        </Button>
      </div>
    </div>
  );
}

function AutoTopUp() {
  const { t, account, viewer, run, act } = useHub();
  const { fmtUsd, amountText, region } = useMoney();
  const pack = t.pack;
  const hub = t.hub[account];
  const a = hub.autoTopUp;
  const consented = !!hub.consents?.[region.id];
  const needsConsent = region.recurring.consentRequired && !consented;
  const [enabled, setEnabled] = useState(a.enabled);
  const [meter, setMeter] = useState(a.meter);
  const [agree, setAgree] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const m = meterOf(pack, meter);
  const local = (usd: number) => Math.round(usd * region.currency.perUsd * 100) / 100;
  const fromLocal = (v: number) => v / region.currency.perUsd;
  const isMoney = m.valueType === "currency";
  const choice = packFor(pack, a.meter, a.units);
  const autoPrice = choice ? choice.pack.price * choice.count : 0;
  const refundable = refundableAutoTopUp(t, account);
  const paused = a.pausedUntil && new Date(a.pausedUntil) > new Date(t.clock);
  const spent = topUpSpend(hub, cycleOf(t).start);

  const save = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const num = (k: string) => Number(f.get(k));
    const threshold = num("threshold");
    const units = num("units");
    const cap = num("cap");
    if (![threshold, units, cap].every((x) => Number.isFinite(x) && x >= 0) || units <= 0) return setError("Use numbers: a threshold of 0 or more, an amount above 0 and a monthly cap of 0 or more.");
    if (enabled && needsConsent && !agree) return setError(`Tick the box to authorise automatic charges in ${region.name}.`);
    setError(null);
    const cfg = {
      enabled,
      meter,
      threshold: isMoney ? fromLocal(threshold) : threshold,
      units: isMoney ? Math.max(1, fromLocal(units)) : units,
      atCap: String(f.get("atCap")) as "stop" | "ask",
      onFail: String(f.get("onFail")) as "backup" | "retry" | "pause",
      pausedUntil: null,
    };
    run(
      (s) => {
        const base = enabled && needsConsent ? recordConsent(s, account, region.id, region.recurring.maxPerCharge, `${region.recurring.title} · ${region.name}`).state : s;
        return saveAutoTopUp(base, account, cfg, fromLocal(cap), viewer.actor).state;
      },
      enabled ? `Auto top-up on. It never spends more than ${fmtUsd(fromLocal(cap), 0)} a month.` : "Auto top-up off.",
    );
  };

  return (
    <section aria-labelledby="auto-title" className="space-y-3">
      <SectionTitle id="auto-title">{pack.billingModel === "prepaid" ? "Auto-reload" : "Auto top-up"}</SectionTitle>
      {paused && (
        <div className="space-y-2 rounded-xl border border-border bg-muted/40 p-3">
          <p className="type-body">Paused until {fmtDate(a.pausedUntil!)}. Your balance still works; nothing tops up automatically.</p>
          <Button size="sm" variant="outline" onClick={() => run((s) => resumeAutoTopUp(s, account, viewer.actor).state, "Auto top-up back on.")}>
            Turn back on now
          </Button>
        </div>
      )}
      <form key={JSON.stringify(a) + hub.topUpCap} onSubmit={save} className="space-y-4 rounded-xl border border-border bg-card p-4" noValidate>
        <div className="flex items-center justify-between gap-3">
          <Label htmlFor="auto-enabled">{pack.billingModel === "prepaid" ? "Reload automatically" : "Top up automatically"}</Label>
          <Switch id="auto-enabled" checked={enabled} onCheckedChange={setEnabled} />
        </div>
        {pack.meters.length > 1 && (
          <div className="space-y-1.5">
            <Label htmlFor="auto-meter">Meter</Label>
            <NativeSelect id="auto-meter" className="w-full" value={meter} onChange={(e) => setMeter(e.target.value)}>
              {pack.meters.map((x) => (
                <NativeSelectOption key={x.id} value={x.id}>
                  {x.label}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </div>
        )}
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="auto-threshold">When balance drops below{isMoney ? ` (${region.currency.code})` : ""}</Label>
            <Input id="auto-threshold" name="threshold" inputMode="decimal" defaultValue={isMoney ? local(a.threshold) : a.threshold} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="auto-units">Add{isMoney ? ` (${region.currency.code})` : ` (${m.label})`}</Label>
            <Input id="auto-units" name="units" inputMode="decimal" defaultValue={isMoney ? local(a.units) : a.units} />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="auto-cap">Monthly spend cap ({region.currency.code})</Label>
          <Input id="auto-cap" name="cap" inputMode="decimal" defaultValue={local(hub.topUpCap)} />
          <p className="type-caption text-muted-foreground">
            {fmtUsd(spent)} of {fmtUsd(hub.topUpCap, 0)} used this cycle.
          </p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="auto-atcap">At the cap</Label>
          <NativeSelect id="auto-atcap" name="atCap" className="w-full" defaultValue={a.atCap}>
            <NativeSelectOption value="stop">Stop topping up; runs pause when the balance runs out</NativeSelectOption>
            <NativeSelectOption value="ask">Ask an admin to allow one more pack</NativeSelectOption>
          </NativeSelect>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="auto-onfail">If the charge fails</Label>
          <NativeSelect id="auto-onfail" name="onFail" className="w-full" defaultValue={a.onFail}>
            <NativeSelectOption value="backup">Charge the backup method{hub.backupCard ? ` (${cardLabel(hub.backupCard)})` : " (none on file yet)"}</NativeSelectOption>
            <NativeSelectOption value="retry">Retry tomorrow and tell me</NativeSelectOption>
            <NativeSelectOption value="pause">Pause auto top-up and tell me</NativeSelectOption>
          </NativeSelect>
        </div>
        {enabled &&
          region.recurring.consentRequired &&
          (consented ? (
            <p className="type-caption text-muted-foreground">
              {region.recurring.title}: given {hub.consents[region.id].at.startsWith("1970") ? "at signup" : fmtDate(hub.consents[region.id].at)} for {region.name}.
            </p>
          ) : (
            <RecurringConsent amountUsd={autoPrice} company={pack.company} checked={agree} onChange={(v) => { setAgree(v); if (v) setError(null); }} error={null} />
          ))}
        {error && (
          <p role="alert" className="type-caption text-blocked-ink">
            {error}
          </p>
        )}
        <p className="type-caption text-muted-foreground">
          {pack.company} suggests: below {amountText(pack.meters[0], pack.autoTopUp.threshold)}, add {amountText(pack.meters[0], pack.autoTopUp.amount)}, cap {fmtUsd(pack.autoTopUp.monthlySpendLimit, 0)}.
        </p>
        <Button type="submit" size="sm">
          Save auto top-up
        </Button>
      </form>
      {a.enabled && !paused && (
        <div className="space-y-2 rounded-xl border border-border bg-card p-4">
          <h3 className="type-body font-semibold">I changed my mind</h3>
          <p className="type-caption text-muted-foreground">
            Pause automatic top-ups without losing your settings.{refundable ? ` The last one (${fmtUsd(refundable.amount)} on ${fmtDate(hub.charges.find((c) => c.id === refundable.chargeId)!.ts)}) is untouched, so it can be refunded too.` : ""}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={() => act((s) => changedMyMind(s, account, 7, !!refundable, viewer.actor), (r) => ({ ok: true, text: `Auto top-up paused for 7 days.${r ? ` ${fmtUsd(r)} refunded.` : ""}` }))}>
              <Undo2 aria-hidden="true" />
              Pause for 7 days{refundable ? " and refund" : ""}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => act((s) => changedMyMind(s, account, null, !!refundable, viewer.actor), (r) => ({ ok: true, text: `Auto top-up off.${r ? ` ${fmtUsd(r)} refunded.` : ""}` }))}>
              Turn off
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}
