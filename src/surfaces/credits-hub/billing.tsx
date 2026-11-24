// Billing parity (Phase 2 §2.9) and payment-failure arrest (§2.10): invoices and receipts with
// credit purchases separate from plan fees, a default and a backup payment method, address,
// tax ID and coupons; payment health with a pre-expiry banner, one-tap card update, backup
// fallback, a soft landing through the grace window, the retry timeline, and exports that
// are never blocked.
import { useState, type FormEvent, type ReactNode } from "react";
import { AlertTriangle, CheckCircle2, CircleDashed, CreditCard, Download, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { SectionTitle } from "@/ui/primitives";
import { ToneBadge } from "@/ui/tone";
import { useMoney } from "@/ui/money";
import { fmtLocal } from "@/core/money";
import { useConfirm } from "@/hooks/use-confirm";
import { useCockpit } from "@/lib/cockpit-store";
import { usePay, RenewalDisclosure, TaxNote } from "@/surfaces/credits-hub/payments";
import { useHub } from "@/surfaces/credits-hub/hub-context";
import { downloadText } from "@/surfaces/credits-hub/usage";
import { applyCoupon, cardLabel, cycleOf, fmtDate, fmtDateTime, planOf, preExpiry, replaceCardAndRetry, retryCharge, runHistory, setBackupCard, updateProfile, usageCsv, type Charge } from "@/core";

/** Persistent payment banner on every tab but Home (Home shows the same state as a moment). */
export function PaymentBanner() {
  const { t, account, viewer } = useHub();
  const tab = useCockpit((s) => s.hubTab);
  const { fmtUsd } = useMoney();
  const pay = usePay();
  const hub = t.hub[account];
  const d = hub.dunning;
  if (tab === "home") return null;
  const canPay = viewer.can("payment");
  const update = () => pay({ usd: 0, cardCheck: true, label: "New card", apply: (s) => replaceCardAndRetry(s, account, viewer.actor).state, okText: "New card on file. Anything unpaid was retried." });
  const admin = hub.team.find((m) => m.role === "admin")?.name ?? "your admin";
  let tone: "blocked" | "atRisk" | "watch" | null = null;
  let text = "";
  if (d.status === "suspended") {
    tone = "blocked";
    text = `Runs are paused until the ${fmtUsd(d.amount)} renewal is paid. Usage, invoices and exports stay open.`;
  } else if (d.status === "grace") {
    tone = "atRisk";
    text = `Your ${fmtUsd(d.amount)} renewal didn't go through. Credits keep working until ${fmtDate(d.graceUntil!)} while it's retried.`;
  } else if (canPay) {
    const pe = preExpiry(hub, t.clock, t.pack.hub.dunning.preExpiryDays);
    if (pe) {
      tone = "watch";
      text = `Your ${pe.which === "backup" ? "backup " : ""}${cardLabel(pe.card)} expires on ${fmtDate(pe.expiresAt)}. Update it now so renewals and top-ups don't fail.`;
    }
  }
  if (!tone) return null;
  const cls = tone === "blocked" ? "border-blocked-ink/30 bg-blocked-soft" : tone === "atRisk" ? "border-at-risk-ink/30 bg-at-risk-soft" : "border-watch-ink/30 bg-watch-soft";
  return (
    <div role={tone === "watch" ? "status" : "alert"} className={`flex flex-wrap items-center justify-between gap-3 rounded-xl border p-3 ${cls}`}>
      <p className="flex items-start gap-2 type-body">
        <AlertTriangle aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
        {text}
      </p>
      {canPay ? (
        <Button size="sm" onClick={update}>
          Update card
        </Button>
      ) : (
        <span className="type-caption">{admin} has been told.</span>
      )}
    </div>
  );
}

export function BillingTab() {
  return (
    <div className="grid gap-6 xl:grid-cols-[400px_minmax(0,1fr)]">
      <div className="space-y-6">
        <PaymentHealth />
        <PaymentMethods />
        <BillingDetails />
        <Coupons />
      </div>
      <div className="min-w-0 space-y-6">
        <NextInvoice />
        <Invoices />
      </div>
    </div>
  );
}

function PaymentHealth() {
  const { t, account, viewer, act } = useHub();
  const { fmtUsd } = useMoney();
  const pay = usePay();
  const hub = t.hub[account];
  const d = hub.dunning;
  const pe = preExpiry(hub, t.clock, t.pack.hub.dunning.preExpiryDays);
  const backupInUse = d.status === "ok" && hub.card.status !== "ok" && hub.backupCard?.status === "ok";
  const label = d.status === "grace" ? "Soft landing" : d.status === "suspended" ? "Runs paused" : d.status === "recovered" ? "Recovered" : backupInUse ? "Backup in use" : pe ? "Card expiring" : "Healthy";
  const tone = d.status === "grace" ? "atRisk" : d.status === "suspended" ? "blocked" : d.status === "recovered" ? "healthy" : backupInUse || pe ? "watch" : "healthy";
  const exportAll = () => {
    const runs = runHistory(t, account, 90);
    downloadText(`${t.pack.id}-usage-90d.csv`, usageCsv(t.pack, hub, runs));
    downloadText(`${t.pack.id}-invoices.csv`, ["date,description,amount_usd,status", ...hub.charges.map((c) => `${c.ts.slice(0, 10)},"${c.description}",${c.amount.toFixed(2)},${c.status}`)].join("\n"));
  };
  return (
    <section aria-labelledby="health-h" className="space-y-3">
      <SectionTitle id="health-h" aside={<ToneBadge tone={tone}>{label}</ToneBadge>}>
        Payment health
      </SectionTitle>
      <div className="space-y-3 rounded-xl border border-border bg-card p-4">
        <p className="type-body">
          {d.status === "grace" && `The ${fmtUsd(d.amount)} renewal failed on ${fmtDate(d.failedAt!)}. Nothing is paused: credits keep working until ${fmtDate(d.graceUntil!)} while ${t.pack.company} retries on the schedule below.`}
          {d.status === "suspended" && `The grace window ended ${fmtDate(d.graceUntil!)} with the ${fmtUsd(d.amount)} renewal unpaid, so new runs are paused. Your data, invoices and exports are untouched.`}
          {d.status === "recovered" && `The last renewal was recovered${d.attempts.some((a) => a.method.startsWith("Backup") && a.outcome === "paid") ? " by your backup method, automatically" : ""}. Nothing else to do.`}
          {d.status === "ok" && (backupInUse ? `Your default ${cardLabel(hub.card)} has expired, so the backup ${cardLabel(hub.backupCard!)} is covering payments. Replace the default so the backup stays a backup.` : pe ? `Your ${cardLabel(pe.card)} expires in ${pe.daysLeft} days. Updating now avoids a failed renewal.` : "Payments are up to date.")}
        </p>
        {d.attempts.length > 0 && (
          <ol aria-label="Retry timeline" className="space-y-2">
            {d.attempts.map((a, i) => (
              <li key={i} className="flex gap-2.5 type-body">
                {a.outcome === "paid" ? <CheckCircle2 aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-healthy-ink" /> : a.outcome === "failed" ? <XCircle aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-blocked-ink" /> : <CircleDashed aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-muted-foreground" />}
                <div>
                  <div>
                    <span className="num">{fmtDate(a.at)}</span> · {a.method} · <span className="font-medium">{a.outcome === "scheduled" ? "Scheduled" : a.outcome === "skipped" ? "Not needed" : a.outcome === "paid" ? "Paid" : "Failed"}</span>
                  </div>
                  <div className="type-caption text-muted-foreground">{a.note}</div>
                </div>
              </li>
            ))}
          </ol>
        )}
        <div className="flex flex-wrap gap-2">
          {viewer.can("payment") && (d.status === "grace" || d.status === "suspended" || pe || backupInUse) && (
            <Button size="sm" onClick={() => pay({ usd: 0, cardCheck: true, label: "New card", apply: (s) => replaceCardAndRetry(s, account, viewer.actor).state, okText: d.status === "ok" ? "New card on file." : "New card on file and the renewal retried." })}>
              <CreditCard aria-hidden="true" />
              Update card{d.status !== "ok" && d.status !== "recovered" ? " and retry" : ""}
            </Button>
          )}
          {viewer.can("payment") && d.status === "recovered" && hub.backupCard && hub.card.status !== "ok" && (
            <Button size="sm" variant="outline" onClick={() => act((s) => setBackupCard(s, account, "make-default", viewer.actor), () => ({ ok: true, text: `${cardLabel(hub.backupCard!)} is now the default.` }))}>
              Make {cardLabel(hub.backupCard)} the default
            </Button>
          )}
          <Button size="sm" variant="outline" onClick={exportAll}>
            <Download aria-hidden="true" />
            Export usage and invoices
          </Button>
        </div>
        <p className="type-caption text-muted-foreground">Exports are never blocked, whatever the payment state. Grace window: {t.pack.hub.dunning.graceDays} days. Retries on days {t.pack.hub.dunning.retryDays.join(", ")}.</p>
      </div>
    </section>
  );
}

function PaymentMethods() {
  const { t, account, viewer, act } = useHub();
  const pay = usePay();
  const confirm = useConfirm();
  const hub = t.hub[account];
  const can = viewer.can("payment");
  const cardRow = (c: typeof hub.card, role: string) => {
    const ok = c.status === "ok";
    return (
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="type-body font-semibold">{cardLabel(c)}</div>
          <div className="type-caption text-muted-foreground">
            {role} · expires {c.expires} · test card, simulated
          </div>
        </div>
        <ToneBadge tone={ok ? "healthy" : "blocked"}>{ok ? "Valid" : "Expired"}</ToneBadge>
      </div>
    );
  };
  return (
    <section aria-labelledby="pm-h" className="space-y-3">
      <SectionTitle id="pm-h">Payment methods</SectionTitle>
      <div className="space-y-4 rounded-xl border border-border bg-card p-4">
        {cardRow(hub.card, "Default")}
        {can && (
          <Button size="sm" variant={hub.card.status === "ok" ? "outline" : "default"} onClick={() => pay({ usd: 0, cardCheck: true, label: "New card", apply: (s) => replaceCardAndRetry(s, account, viewer.actor).state, okText: "New card on file." })}>
            Replace default card
          </Button>
        )}
        <div className="border-t border-border pt-4">
          {hub.backupCard ? (
            <div className="space-y-3">
              {cardRow(hub.backupCard, "Backup")}
              <p className="type-caption text-muted-foreground">Charged automatically if the default card fails: renewals, and auto top-ups set to use it.</p>
              {can && (
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" onClick={() => act((s) => setBackupCard(s, account, "make-default", viewer.actor), () => ({ ok: true, text: "Default and backup swapped." }))}>
                    Make default
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={async () => {
                      if (await confirm({ title: `Remove ${cardLabel(hub.backupCard!)}?`, description: "Failed payments won't fall back to it any more.", confirmLabel: "Remove backup" })) act((s) => setBackupCard(s, account, "remove", viewer.actor), () => ({ ok: true, text: "Backup method removed." }));
                    }}
                  >
                    Remove
                  </Button>
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-2">
              <p className="type-body text-muted-foreground">No backup method. With one, a failed renewal or top-up is retried on it straight away.</p>
              {can && (
                <Button size="sm" variant="outline" onClick={() => pay({ usd: 0, cardCheck: true, label: "Backup card", apply: (s) => setBackupCard(s, account, "add", viewer.actor).state, okText: "Backup method added." })}>
                  Add a backup card
                </Button>
              )}
            </div>
          )}
        </div>
        <p className="type-caption text-muted-foreground">Cards are collected on the hosted payment page; only the brand and last four digits come back here.</p>
      </div>
    </section>
  );
}

function BillingDetails() {
  const { t, account, viewer, run } = useHub();
  const { region } = useMoney();
  const hub = t.hub[account];
  const p = hub.profile;
  const [error, setError] = useState<string | null>(null);
  const can = viewer.can("payment");
  const save = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const g = (k: string) => String(f.get(k) ?? "").trim();
    if (!g("company") || !g("line1") || !g("city")) return setError("Company, street and city are needed on invoices.");
    if (g("email") && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(g("email"))) return setError("The invoice e-mail doesn't look like an e-mail address.");
    setError(null);
    run((s) => updateProfile(s, account, { company: g("company"), address: { line1: g("line1"), city: g("city"), postcode: g("postcode"), country: g("country") }, taxId: g("taxId") || null, email: g("email") || p.email }, viewer.actor).state, "Billing details saved. They appear on the next invoice.");
  };
  return (
    <section aria-labelledby="bd-h" className="space-y-3">
      <SectionTitle id="bd-h">Billing details</SectionTitle>
      <form key={JSON.stringify(p)} onSubmit={save} className="space-y-3 rounded-xl border border-border bg-card p-4" noValidate>
        <Field id="bd-company" name="company" label="Company" value={p.company} disabled={!can} />
        <Field id="bd-line1" name="line1" label="Street" value={p.address.line1} disabled={!can} />
        <div className="grid grid-cols-2 gap-3">
          <Field id="bd-city" name="city" label="City" value={p.address.city} disabled={!can} />
          <Field id="bd-postcode" name="postcode" label="Postcode" value={p.address.postcode} disabled={!can} />
        </div>
        <Field id="bd-country" name="country" label="Country" value={p.address.country} disabled={!can} />
        <Field id="bd-tax" name="taxId" label={region.tax.idLabel ?? "Tax ID"} value={p.taxId ?? ""} placeholder="Optional" disabled={!can} />
        <Field id="bd-email" name="email" label="Invoices go to" value={p.email} disabled={!can} />
        {error && (
          <p role="alert" className="type-caption text-blocked-ink">
            {error}
          </p>
        )}
        {can && (
          <Button type="submit" size="sm">
            Save details
          </Button>
        )}
      </form>
    </section>
  );
}

function Field({ id, name, label, value, placeholder, disabled }: { id: string; name: string; label: string; value: string; placeholder?: string; disabled?: boolean }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} name={name} defaultValue={value} placeholder={placeholder} disabled={disabled} />
    </div>
  );
}

function Coupons() {
  const { t, account, viewer, act } = useHub();
  const hub = t.hub[account];
  const [code, setCode] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!code.trim()) return setMsg({ ok: false, text: "Enter a code first." });
    const r = act((s) => applyCoupon(s, account, code, viewer.actor), (x) => (x.ok ? { ok: true, text: x.note } : null));
    if (r) setMsg({ ok: r.ok, text: r.note });
    if (r?.ok) setCode("");
  };
  return (
    <section aria-labelledby="cp-h" className="space-y-3">
      <SectionTitle id="cp-h">Coupons</SectionTitle>
      <div className="space-y-3 rounded-xl border border-border bg-card p-4">
        {hub.profile.coupons.length ? (
          <ul className="space-y-1 type-body">
            {hub.profile.coupons.map((c) => (
              <li key={c.code}>
                <span className="font-medium">{c.code}</span> · {c.label} · applied {fmtDate(c.appliedAt)}
              </li>
            ))}
          </ul>
        ) : (
          <p className="type-body text-muted-foreground">No coupons on the account.</p>
        )}
        {viewer.can("payment") && (
          <form onSubmit={submit} className="flex gap-2" noValidate>
            <Label htmlFor="cp-code" className="sr-only">
              Coupon code
            </Label>
            <Input id="cp-code" value={code} onChange={(e) => setCode(e.target.value)} placeholder="Code" aria-invalid={msg ? !msg.ok : undefined} aria-describedby="cp-msg" />
            <Button type="submit" size="sm" variant="outline">
              Apply
            </Button>
          </form>
        )}
        <p id="cp-msg" role={msg && !msg.ok ? "alert" : undefined} className={`type-caption ${msg ? (msg.ok ? "text-healthy-ink" : "text-blocked-ink") : "sr-only"}`}>
          {msg?.text ?? ""}
        </p>
      </div>
    </section>
  );
}

function NextInvoice() {
  const { t, account } = useHub();
  const { fmtUsd, region, tax } = useMoney();
  const pack = t.pack;
  const hub = t.hub[account];
  const plan = planOf(pack, hub.planId);
  const next = hub.nextPlanId ? planOf(pack, hub.nextPlanId) : plan;
  const { end } = cycleOf(t);
  const addOns = Object.entries(hub.profile.addOns).filter(([, n]) => n > 0);
  const addOnUsd = addOns.reduce((s, [m, n]) => s + (pack.hub.expansion[m]?.price ?? 0) * n, 0);
  const coupon = hub.profile.coupons[0];
  const annual = hub.profile.billing === "annual";
  const base = hub.status === "paused" || hub.status === "cancelling" || annual ? 0 : (next.price ?? 0) + addOnUsd;
  const discount = coupon ? (base * coupon.pctOff) / 100 : 0;
  const net = Math.max(0, base - discount);
  const inv = tax(net);
  return (
    <section aria-labelledby="ni-h" className="space-y-3">
      <SectionTitle id="ni-h">Next invoice</SectionTitle>
      <dl className="space-y-2 rounded-xl border border-border bg-card p-4 type-body">
        <Line k="Date">{hub.status === "cancelling" ? "None · cancels" : fmtDate(end)}</Line>
        <Line k={`${next.name} plan`}>{hub.status === "paused" ? `${fmtUsd(0)} · paused` : annual ? "Covered by the annual term" : next.price == null ? "Custom" : fmtUsd(next.price)}</Line>
        {addOns.length > 0 && !annual && <Line k="Extra included credits">{fmtUsd(addOnUsd)}</Line>}
        {coupon && discount > 0 && <Line k={`Coupon ${coupon.code}`}>−{fmtUsd(discount)}</Line>}
        {net > 0 && (
          <>
            <Line k={`${region.tax.name}${region.tax.rate != null ? ` ${Math.round(region.tax.rate * 100)}%` : ""}`}>{inv.tax == null ? "Where applicable" : fmtLocal(inv.tax, region)}</Line>
            <Line k="Total" strong>
              {fmtLocal(inv.gross, region)}
            </Line>
          </>
        )}
        <Line k="Credit top-ups">Billed separately when bought</Line>
      </dl>
      <TaxNote />
      {plan.paid && plan.price != null && hub.status === "active" && !annual && <RenewalDisclosure planName={next.name} priceUsd={next.price} date={fmtDate(end)} company={pack.company} />}
    </section>
  );
}

function Line({ k, children, strong }: { k: string; children: ReactNode; strong?: boolean }) {
  return (
    <div className={`flex justify-between gap-3 ${strong ? "border-t border-border pt-2 font-semibold" : ""}`}>
      <dt>{k}</dt>
      <dd className="text-right num">{children}</dd>
    </div>
  );
}

function Invoices() {
  const { t, account, viewer } = useHub();
  const { charged, note } = useMoney();
  const pay = usePay();
  const hub = t.hub[account];
  const plan = hub.charges.filter((c) => !c.meter).slice().reverse();
  const credit = hub.charges.filter((c) => c.meter).slice().reverse();
  const download = (c: Charge, kind: string) => {
    const p = hub.profile;
    const text = [
      `${t.pack.brand.wordmark} · ${kind}`,
      `Test document, simulated`,
      ``,
      `Billed to: ${p.company}`,
      `${p.address.line1}, ${p.address.city} ${p.address.postcode}, ${p.address.country}`,
      p.taxId ? `Tax ID: ${p.taxId}` : "",
      ``,
      `${kind} ${c.id} · ${fmtDateTime(c.ts)}`,
      `${c.description}`,
      `Amount: ${charged(c.amount)}`,
      `Status: ${c.status}${c.reason ? ` (${c.reason})` : ""}`,
    ]
      .filter((l) => l !== null)
      .join("\n");
    downloadText(`${c.id}.txt`, text, "text/plain");
  };
  const table = (rows: Charge[], kind: "Invoice" | "Receipt", caption: string, empty: string) =>
    rows.length ? (
      <div className="overflow-x-auto rounded-xl border border-border">
        <Table>
          <TableCaption className="sr-only">{caption}</TableCaption>
          <TableHeader>
            <TableRow>
              <TableHead>Date</TableHead>
              <TableHead>Description</TableHead>
              <TableHead className="text-right">Amount</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>
                <span className="sr-only">Actions</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((c) => (
              <TableRow key={c.id}>
                <TableCell className="whitespace-nowrap num">{fmtDate(c.ts)}</TableCell>
                <TableCell>
                  {note(c.description)}
                  {c.reason && <div className="type-caption text-muted-foreground">{c.reason}</div>}
                </TableCell>
                <TableCell className="text-right num">{charged(c.amount)}</TableCell>
                <TableCell>
                  <ToneBadge tone={c.status === "failed" ? "blocked" : c.status === "refunded" ? "neutral" : "healthy"}>{c.status === "paid" ? "Paid" : c.status === "recovered" ? "Recovered" : c.status === "refunded" ? "Refunded" : "Unpaid"}</ToneBadge>
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-1">
                    {c.status === "failed" && c.meter && viewer.can("payment") && hub.card.status === "ok" && (
                      <Button size="sm" variant="outline" onClick={() => pay({ usd: c.amount, label: note(c.description), apply: (s) => retryCharge(s, account, c.id).state, okText: `${charged(c.amount)} collected.` })}>
                        Retry
                      </Button>
                    )}
                    <Button size="sm" variant="ghost" aria-label={`Download ${kind.toLowerCase()} ${c.id}`} onClick={() => download(c, kind)}>
                      <Download aria-hidden="true" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    ) : (
      <p className="type-body text-muted-foreground">{empty}</p>
    );
  return (
    <>
      <section aria-labelledby="inv-h" className="space-y-3">
        <SectionTitle id="inv-h">Plan invoices</SectionTitle>
        {table(plan, "Invoice", "Plan invoices, newest first", "No plan invoices yet. The first one is issued at renewal.")}
      </section>
      <section aria-labelledby="rc-h" className="space-y-3">
        <SectionTitle id="rc-h">Credit purchases</SectionTitle>
        {table(credit, "Receipt", "Credit purchase receipts, newest first", "No credit purchases yet.")}
      </section>
    </>
  );
}
