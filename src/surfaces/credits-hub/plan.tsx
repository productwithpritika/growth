// Plan fit and plan change (Phase 2 §2.7) with pause, downgrade and cancel (§2.11).
// Plan Fit replays the last 90 days against every plan and meter size; sliders size Data
// Credits and Actions independently; the preview shows monthly versus annual, proration and
// the effective date; changes can be undone for 24 hours; existing terms are protected.
// Cancelling is one visible path with an honest summary and optional offers matched to the reason.
import { useMemo, useState, type ReactNode } from "react";
import { ShieldCheck, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { SectionTitle } from "@/ui/primitives";
import { ToneBadge } from "@/ui/tone";
import { useMoney } from "@/ui/money";
import { usePay } from "@/surfaces/credits-hub/payments";
import { useHub } from "@/surfaces/credits-hub/hub-context";
import {
  acceptOffer,
  applyPlanChange,
  CANCEL_REASONS,
  cancelSubscription,
  configAllowance,
  currentConfig,
  cycleOf,
  evaluateFit,
  fmtDate,
  fmtDateTime,
  keepSubscription,
  ladder,
  lotsOf,
  meterOf,
  monthlyAllowance,
  OFFERS_FOR,
  packFor,
  pauseSubscription,
  planFit,
  planOf,
  previewPlanChange,
  primaryMeter,
  resumeSubscription,
  undoPlanChange,
  type CancelReason,
  type FitResult,
  type OfferId,
  type PlanConfig,
} from "@/core";

export function PlanTab() {
  const { t, account } = useHub();
  const fit = useMemo(() => planFit(t, account), [t, account]);
  const [cfg, setCfg] = useState<PlanConfig>(() => currentConfig(t, account));
  return (
    <div className="space-y-8">
      <UndoBanner />
      <FitSummary fit={fit.cheapest} noRunOut={fit.noRunOut} current={fit.current} onTry={(c) => setCfg({ ...c, billing: cfg.billing })} />
      <Configurator cfg={cfg} setCfg={setCfg} windows={fit.windows} />
      <PauseAndCancel bestPlanId={fit.cheapest && (planOf(t.pack, fit.cheapest.cfg.planId).price ?? 0) < (planOf(t.pack, t.hub[account].planId).price ?? 0) ? fit.cheapest.cfg.planId : null} />
    </div>
  );
}

function UndoBanner() {
  const { t, account, viewer, act } = useHub();
  const c = t.hub[account].planChange;
  if (!c || c.undone || new Date(t.clock).getTime() + t.tick * 60_000 > new Date(c.undoUntil).getTime()) return null;
  const from = planOf(t.pack, c.prev.planId);
  const to = planOf(t.pack, c.to);
  return (
    <div role="status" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-info-ink/30 bg-info-soft p-4">
      <p className="type-body">
        {c.effective === "now" ? `You moved from ${from.name} to ${to.name} on ${fmtDateTime(c.at)}.` : `${to.name} is scheduled for ${fmtDate(cycleOf(t).end)}.`} You can undo this until {fmtDateTime(c.undoUntil)}
        {c.chargeId ? "; the prorated charge is refunded in full" : ""}.
      </p>
      <Button size="sm" variant="outline" onClick={() => act((s) => undoPlanChange(s, account, viewer.actor), (r) => ({ ok: r.ok, text: r.note }))}>
        <Undo2 aria-hidden="true" />
        Undo
      </Button>
    </div>
  );
}

function FitSummary({ fit, noRunOut, current, onTry }: { fit: FitResult | null; noRunOut: FitResult | null; current: FitResult | null; onTry: (c: PlanConfig) => void }) {
  const { fmtUsd } = useMoney();
  const cards = [
    { id: "cheapest", title: "Cheapest fit", r: fit, note: "Lowest total over 90 days, top-ups included" },
    { id: "safe", title: "Never runs out", r: noRunOut, note: "Lowest total with no top-ups needed" },
    { id: "current", title: "What you have", r: current, note: "Your plan against the same 90 days" },
  ];
  return (
    <section aria-labelledby="fit-h" className="space-y-3">
      <SectionTitle id="fit-h">Plan fit, replaying your last 90 days</SectionTitle>
      <ul className="grid gap-3 md:grid-cols-3">
        {cards.map((c) => (
          <li key={c.id} className="flex flex-col justify-between gap-3 rounded-xl border border-border bg-card p-4">
            <div className="space-y-1">
              <div className="type-caption text-muted-foreground">{c.title}</div>
              {c.r ? (
                <>
                  <div className="type-heading">{c.r.label}</div>
                  <div className="type-body num">
                    {fmtUsd(c.r.total, 0)} over 90 days{c.r.topUps > 0 ? ` (${fmtUsd(c.r.topUps, 0)} in top-ups)` : ""}
                  </div>
                  {c.r.shortWindows > 0 && <p className="type-caption text-watch-ink">Would have paused in {c.r.shortWindows} of 3 months.</p>}
                </>
              ) : (
                <div className="type-body text-muted-foreground">No plan fits without talking to sales.</div>
              )}
              <p className="type-caption text-muted-foreground">{c.note}</p>
            </div>
            {c.r && c.id !== "current" && (
              <Button size="sm" variant="outline" onClick={() => onTry(c.r!.cfg)}>
                Try this
              </Button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

function Configurator({ cfg, setCfg, windows }: { cfg: PlanConfig; setCfg: (c: PlanConfig) => void; windows: ReturnType<typeof planFit>["windows"] }) {
  const { t, account, viewer, act } = useHub();
  const { fmtUsd, amountText, price, suffix } = useMoney();
  const pay = usePay();
  const pack = t.pack;
  const plans = ladder(pack, "cockpit");
  const plan = planOf(pack, cfg.planId);
  const r = evaluateFit(t, windows, cfg);
  const pv = previewPlanChange(t, account, cfg);
  const exp = pack.hub.expansion;
  const disc = pack.hub.annualDiscountPct;
  const apply = () => {
    const go = (s: typeof t) => {
      const x = applyPlanChange(s, account, cfg, viewer.actor);
      return x.result.ok ? x.state : s;
    };
    if (pv.effective === "now" && pv.prorationUsd > 0) pay({ usd: pv.prorationUsd, label: `Change to ${plan.name}`, apply: go, okText: `You're on ${plan.name}. Undo within ${pv.undoHours} hours if it isn't right.` });
    else act((s) => applyPlanChange(s, account, cfg, viewer.actor), (x) => ({ ok: x.ok, text: x.note }));
  };
  return (
    <section aria-labelledby="cfg-h" className="space-y-4">
      <SectionTitle
        id="cfg-h"
        aside={
          disc > 0 && (
            <ToggleGroup type="single" size="sm" variant="outline" aria-label="Billing period" value={cfg.billing} onValueChange={(v) => v && setCfg({ ...cfg, billing: v as "monthly" | "annual" })}>
              <ToggleGroupItem value="monthly">Monthly</ToggleGroupItem>
              <ToggleGroupItem value="annual">Annual · save {disc}%</ToggleGroupItem>
            </ToggleGroup>
          )
        }
      >
        Size your plan
      </SectionTitle>
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="min-w-0 space-y-4">
          <RadioGroup value={cfg.planId} onValueChange={(v) => setCfg({ ...cfg, planId: v, addOns: planOf(pack, v).paid ? cfg.addOns : {} })} className="grid gap-2 sm:grid-cols-2 2xl:grid-cols-3" aria-label="Plan">
            {plans.map((p) => (
              <Label key={p.id} htmlFor={`pl-${p.id}`} className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3 font-normal ${p.id === cfg.planId ? "border-primary bg-primary/5" : "border-border bg-card"}`}>
                <RadioGroupItem id={`pl-${p.id}`} value={p.id} className="mt-1" />
                <span className="min-w-0 space-y-0.5">
                  <span className="flex flex-wrap items-center gap-2 type-body font-medium">
                    {p.name}
                    {p.id === t.hub[account].planId && <ToneBadge tone="neutral">Current</ToneBadge>}
                    {p.proposed && <ToneBadge tone="info">Proposed</ToneBadge>}
                  </span>
                  <span className="block type-caption text-muted-foreground">
                    {p.price == null ? "Custom pricing" : p.price === 0 ? "Free" : `${price(cfg.billing === "annual" ? p.price * (1 - disc / 100) : p.price, 0)}/mo ${suffix}`} · {pack.meters.map((m) => amountText(m, monthlyAllowance(pack, p.id, m.id))).join(" · ")}
                  </span>
                </span>
              </Label>
            ))}
          </RadioGroup>
          {plan.paid &&
            pack.meters
              .filter((m) => exp[m.id])
              .map((m) => {
                const e = exp[m.id];
                const n = cfg.addOns[m.id] ?? 0;
                return (
                  <div key={m.id} className="space-y-2 rounded-xl border border-border bg-card p-4">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <Label htmlFor={`exp-${m.id}`}>Extra {m.label} each month</Label>
                      <span className="type-body num">
                        +{amountText(m, e.step * n)} · {fmtUsd(e.price * n, 0)}/mo · {amountText(m, configAllowance(t, cfg, m.id))} in total
                      </span>
                    </div>
                    <Slider id={`exp-${m.id}`} min={0} max={e.max} step={1} value={[n]} onValueChange={(v) => setCfg({ ...cfg, addOns: { ...cfg.addOns, [m.id]: v[0] } })} aria-label={`Extra ${m.label}`} aria-valuetext={`${amountText(m, e.step * n)} extra`} />
                    <p className="type-caption text-muted-foreground">
                      Blocks of {amountText(m, e.step)} at {fmtUsd(e.price, 0)} ({fmtUsd(e.price / e.step, 4)} each). {pack.meters.length > 1 ? "Sized independently of the other meter." : ""}
                    </p>
                  </div>
                );
              })}
          {r ? (
            <div className="overflow-x-auto rounded-xl border border-border">
              <Table>
                <TableCaption className="text-left">
                  {r.label}: {fmtUsd(r.total, 0)} over the last 90 days{r.topUps ? `, ${fmtUsd(r.topUps, 0)} of it top-ups` : ""}.{r.shortWindows ? ` Work would have paused in ${r.shortWindows} of 3 months.` : ""}
                </TableCaption>
                <TableHeader>
                  <TableRow>
                    <TableHead>30 days to</TableHead>
                    {pack.meters.map((m) => (
                      <TableHead key={m.id} className="text-right">
                        {m.label}: used / included
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {r.windows.map((w, i) => (
                    <TableRow key={windows[i].to}>
                      <TableCell className="num">{fmtDate(windows[i].to)}</TableCell>
                      {w.map((x) => (
                        <TableCell key={x.meter} className={`text-right num ${x.over > 0 ? "text-watch-ink" : ""}`}>
                          {amountText(meterOf(pack, x.meter), x.demand, { label: false })} / {amountText(meterOf(pack, x.meter), x.allowance, { label: false })}
                          {x.over > 0 ? " · over" : ""}
                        </TableCell>
                      ))}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : (
            <p className="type-body text-muted-foreground">{plan.name} is priced by the sales team. They'll size it from the same 90 days.</p>
          )}
        </div>
        <aside aria-labelledby="pv-h" className="space-y-3 rounded-xl border border-border bg-card p-4">
          <h3 id="pv-h" className="type-heading">
            {pv.direction === "same" ? "This is your plan" : `Change to ${plan.name}`}
          </h3>
          {pv.custom ? (
            <p className="type-body text-muted-foreground">Custom pricing. Ask {pack.company} sales for a quote based on your usage.</p>
          ) : pv.direction === "same" ? (
            <p className="type-body text-muted-foreground">Move the sliders or pick another plan to see the difference.</p>
          ) : (
            <dl className="space-y-2 type-body">
              <Row k="New price">
                {fmtUsd(pv.toMonthly ?? 0)}/mo{cfg.billing === "annual" ? `, billed ${fmtUsd(pv.annualTotal ?? 0, 0)} a year` : ""}
              </Row>
              <Row k="Today">{pv.effective === "now" ? `${fmtUsd(pv.prorationUsd)} prorated for ${pv.daysLeft} days` : "Nothing"}</Row>
              <Row k="Takes effect">{pv.effective === "now" ? "Now" : fmtDate(pv.effectiveDate)}</Row>
              {pv.effective === "now" && Object.values(pv.grantsNow).some((v) => v > 0) && (
                <Row k="Added now">
                  {pack.meters
                    .filter((m) => (pv.grantsNow[m.id] ?? 0) > 0)
                    .map((m) => amountText(m, pv.grantsNow[m.id]))
                    .join(" · ")}
                </Row>
              )}
              <Row k="Next invoice">{pv.nextInvoiceUsd == null ? "Custom" : `${fmtUsd(pv.nextInvoiceUsd)} on ${fmtDate(cycleOf(t).end)}`}</Row>
              <Row k="Undo">Within {pv.undoHours} hours, refunded in full</Row>
            </dl>
          )}
          <p className="flex gap-2 rounded-lg bg-muted/50 p-3 type-caption">
            <ShieldCheck aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
            Your current terms are protected. Price changes never apply to existing paid subscriptions; you only move when you choose to.
          </p>
          <Button className="w-full" disabled={pv.custom || pv.direction === "same" || !viewer.can("plan")} onClick={apply}>
            {pv.direction === "down" ? `Switch at renewal` : pv.direction === "up" ? `Change now${pv.prorationUsd ? ` · ${fmtUsd(pv.prorationUsd)}` : ""}` : "Change plan"}
          </Button>
        </aside>
      </div>
    </section>
  );
}

function Row({ k, children }: { k: string; children: ReactNode }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-muted-foreground">{k}</dt>
      <dd className="text-right font-medium num">{children}</dd>
    </div>
  );
}

function PauseAndCancel({ bestPlanId }: { bestPlanId: string | null }) {
  const { t, account, viewer, run, act } = useHub();
  const pack = t.pack;
  const hub = t.hub[account];
  const plan = planOf(pack, hub.planId);
  const { end } = cycleOf(t);
  const [cycles, setCycles] = useState(1);
  const [open, setOpen] = useState(false);
  const policy = pack.hub.pausePolicy;
  if (!plan.paid && hub.status === "active") return null;
  return (
    <section aria-labelledby="pc-h" className="space-y-3">
      <SectionTitle id="pc-h">Pause or cancel</SectionTitle>
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-3 rounded-xl border border-border bg-card p-4">
          <h3 className="type-body font-semibold">Pause</h3>
          {hub.status === "paused" ? (
            <>
              <p className="type-body">Paused until {hub.pause ? fmtDate(hub.pause.until) : fmtDate(end)}. {hub.pause?.policy === "freeze" ? "Balances are frozen: nothing expires and nothing runs." : "Credits you already have keep working; nothing new is billed."}</p>
              <Button size="sm" onClick={() => run((s) => resumeSubscription(s, account, viewer.actor).state, "Welcome back. Billing resumes at the next renewal.")}>
                Resume now
              </Button>
            </>
          ) : (
            <>
              <p className="type-body text-muted-foreground">No charge while paused. {policy === "freeze" ? "Balances are frozen: nothing expires, nothing runs, everything is waiting when you're back." : "Credits you already have keep working until they expire; no new allowance arrives."}</p>
              <div className="flex flex-wrap items-end gap-2">
                <div className="space-y-1">
                  <Label htmlFor="pause-cycles">For</Label>
                  <NativeSelect id="pause-cycles" size="sm" value={cycles} onChange={(e) => setCycles(Number(e.target.value))}>
                    {Array.from({ length: pack.hub.pauseMaxCycles }, (_, i) => i + 1).map((n) => (
                      <NativeSelectOption key={n} value={n}>
                        {n} cycle{n === 1 ? "" : "s"}
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                </div>
                <Button size="sm" variant="outline" disabled={hub.status !== "active"} onClick={() => act((s) => pauseSubscription(s, account, cycles, null, viewer.actor), (u) => ({ ok: true, text: `Paused until ${fmtDate(u)}. Resume any time.` }))}>
                  Pause
                </Button>
              </div>
            </>
          )}
        </div>
        <div className="space-y-3 rounded-xl border border-border bg-card p-4">
          <h3 className="type-body font-semibold">Cancel</h3>
          {hub.status === "cancelling" ? (
            <>
              <p className="type-body">Cancels on {fmtDate(end)}. You keep everything until then, then move to the free plan with your tables and data intact.</p>
              <Button size="sm" onClick={() => run((s) => resumeSubscription(s, account, viewer.actor).state, "Cancellation withdrawn. Nothing changes.")}>
                Keep my subscription
              </Button>
            </>
          ) : (
            <>
              <p className="type-body text-muted-foreground">As easy as subscribing: one question, an honest summary, and the cancel button is always one click away.</p>
              <Button size="sm" variant="outline" disabled={!viewer.can("plan")} onClick={() => setOpen(true)}>
                Cancel subscription
              </Button>
            </>
          )}
        </div>
      </div>
      {open && <CancelFlow onClose={() => setOpen(false)} bestPlanId={bestPlanId} />}
    </section>
  );
}

function CancelFlow({ onClose, bestPlanId }: { onClose: () => void; bestPlanId: string | null }) {
  const { t, account, viewer, act, silent } = useHub();
  const { amountText, fmtUsd } = useMoney();
  const pack = t.pack;
  const hub = t.hub[account];
  const plan = planOf(pack, hub.planId);
  const { end } = cycleOf(t);
  const [reason, setReason] = useState<CancelReason | null>(null);
  const [shown, setShown] = useState<OfferId | null>(null);
  const prim = primaryMeter(pack);
  const free = pack.plans.find((p) => !p.paid);
  const lots = pack.meters.map((m) => {
    const ls = lotsOf(t.ledger, account, m.id);
    const planLots = ls.filter((l) => l.source === "plan" || l.source === "rollover").reduce((s, l) => s + l.remaining, 0);
    const topups = ls.filter((l) => l.source === "topup");
    const rewards = ls.filter((l) => l.source === "reward" || l.source === "promo");
    return { m, planLots, topups, rewards };
  });
  const offers = reason ? OFFERS_FOR[reason] : [];
  const best = bestPlanId ? planOf(pack, bestPlanId) : null;
  const ap = packFor(pack, prim.id, pack.autoTopUp.amount);
  const offerCopy: Record<OfferId, { title: string; body: string }> = {
    downgrade: { title: best ? `Move to ${best.name}` : "Move to a smaller plan", body: best ? `${fmtUsd(best.price ?? 0, 0)} a month from ${fmtDate(end)}. Your last 90 days fit it.` : "No smaller plan fits your usage." },
    "own-key": { title: "Bring your own API key", body: `Email lookups on your key cost 0 ${prim.label}; only ${pack.meters[1]?.label ?? "platform"} costs remain.` },
    "auto-top-up": { title: "Turn on auto top-up", body: `Below ${amountText(prim, pack.autoTopUp.threshold)}, add ${amountText(prim, pack.autoTopUp.amount)}${ap ? ` for ${fmtUsd(ap.pack.price * ap.count)}` : ""}, never more than ${fmtUsd(pack.autoTopUp.monthlySpendLimit, 0)} a month.` },
    rollover: { title: "A 20% rollover bonus", body: `+${amountText(prim, Math.round(monthlyAllowance(pack, hub.planId, prim.id) * 0.2))} now, valid 60 days, paid for by credits that would otherwise expire unused.` },
    pause: { title: "Pause for a cycle instead", body: `No charge until ${fmtDate(new Date(end.getTime() + 30 * 86_400_000))}. ${pack.hub.pausePolicy === "freeze" ? "Balances are frozen." : "Your credits keep working."}` },
    template: { title: "Try a guided template", body: `${pack.hub.templateTable}, with the first column set up for you.` },
    "support-review": { title: "Ask for an accuracy review", body: "A specialist checks 20 recent rows within one business day. Wrong records are credited back." },
  };
  const take = (o: OfferId) => {
    act((s) => {
      const r = acceptOffer(s, account, reason!, o, viewer.actor, bestPlanId);
      return { state: r.state, result: r.note };
    }, (note) => ({ ok: true, text: note || "Done." }));
    onClose();
  };
  const cancelNow = () => {
    act((s) => cancelSubscription(s, account, reason ?? "other", shown, viewer.actor), () => ({ ok: true, text: `Cancelled. You keep ${plan.name} until ${fmtDate(end)}, then move to ${free?.name ?? "the free plan"}.` }));
    onClose();
  };
  const close = () => {
    silent((s) => keepSubscription(s, account, reason));
    onClose();
  };
  return (
    <Dialog open onOpenChange={(v) => !v && close()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Cancel {plan.name}</DialogTitle>
          <DialogDescription>Here's exactly what happens. Offers below are optional; the cancel button is always at the bottom.</DialogDescription>
        </DialogHeader>
        <section aria-label="What happens" className="space-y-2 rounded-lg bg-muted/50 p-3 type-body">
          <p>
            You keep {plan.name} until <span className="font-medium">{fmtDate(end)}</span>, then move to {free?.name ?? "the free plan"}
            {free ? ` (${pack.meters.map((m) => amountText(m, free.included[m.id] ?? 0)).join(", ")} a month)` : ""}. No further charges.
          </p>
          <ul className="list-disc space-y-1 pl-5">
            {lots.map(({ m, planLots, topups, rewards }) => (
              <li key={m.id}>
                {m.label}: {planLots > 0 ? `${amountText(m, planLots)} of plan and rollover credits expire on ${fmtDate(end)}` : "no plan credits left to lose"}
                {topups.length ? `; ${amountText(m, topups.reduce((s, l) => s + l.remaining, 0))} of top-ups stay yours until ${fmtDate(topups.map((l) => l.expiresAt ?? "9999").sort()[0])}` : ""}
                {rewards.length ? `; ${amountText(m, rewards.reduce((s, l) => s + l.remaining, 0))} of rewards keep their own dates` : ""}.
              </li>
            ))}
            <li>Tables, enriched data and invoices stay. Exports are always available.</li>
          </ul>
        </section>
        <fieldset className="space-y-2">
          <legend className="type-body font-medium">What's the main reason? (optional)</legend>
          <RadioGroup value={reason ?? ""} onValueChange={(v) => { setReason(v as CancelReason); setShown(OFFERS_FOR[v as CancelReason][0] ?? null); }}>
            {CANCEL_REASONS.map((r) => (
              <div key={r.id} className="flex items-center gap-2">
                <RadioGroupItem id={`cr-${r.id}`} value={r.id} />
                <Label htmlFor={`cr-${r.id}`} className="font-normal">
                  {r.label}
                </Label>
              </div>
            ))}
          </RadioGroup>
        </fieldset>
        {reason && offers.length > 0 && (
          <section aria-label="Offers matched to your reason" className="space-y-2">
            <h3 className="type-body font-medium">Something that might help (optional)</h3>
            <ul className="space-y-2">
              {offers
                .filter((o) => o !== "downgrade" || best)
                .map((o) => (
                  <li key={o} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border p-3">
                    <div className="min-w-0 flex-1">
                      <div className="type-body font-medium">{offerCopy[o].title}</div>
                      <p className="type-caption text-muted-foreground">{offerCopy[o].body}</p>
                    </div>
                    <Button size="sm" variant="outline" onClick={() => take(o)}>
                      {o === "support-review" ? "Request review" : "Take this"}
                    </Button>
                  </li>
                ))}
            </ul>
          </section>
        )}
        {reason && offers.length === 0 && <p className="type-caption text-muted-foreground">Thanks for telling us. It goes to the {pack.company} team as-is.</p>}
        <DialogFooter className="gap-2 sm:justify-between">
          <Button variant="ghost" onClick={close}>
            Keep my subscription
          </Button>
          <Button
            variant="destructive"
            onClick={cancelNow}
          >
            {reason && offers.length ? "No thanks, cancel" : "Cancel subscription"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
