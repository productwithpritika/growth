// Region policy in the Credits Hub (Phase 1 §1.7): the strong-authentication prompt before a
// card payment, recurring-payment consent for auto top-up, the auto-renewal disclosure and the
// tax line. Prompts are simulated: no card details or codes are ever collected here.
import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import { ShieldCheck, Smartphone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useMoney } from "@/ui/money";
import { chargedTotal, fillCopy, fmtLocal, needsStrongAuth, overMandateLimit, taxBreakdown } from "@/core/money";
import { recordPaymentAuth } from "@/core/actions";
import type { TenantState } from "@/core/types";
import type { RegionPack } from "@/tenants/region-schema";
import { cn } from "@/lib/utils";

export interface PayRequest {
  /** Net amount in USD; the prompt shows it converted with tax. */
  usd: number;
  label: string;
  apply: (s: TenantState) => TenantState;
  okText: string;
  /** Adding or replacing a card: a zero-amount check that still needs authentication where required. */
  cardCheck?: boolean;
}

type Pay = (r: PayRequest) => void;
type Run = (fn: (s: TenantState) => TenantState, okText: string) => void;

const PayContext = createContext<Pay | null>(null);

/** Start a card payment; shows the region's strong-authentication prompt when the payment needs one. */
export function usePay(): Pay {
  const pay = useContext(PayContext);
  if (!pay) throw new Error("usePay needs a PaymentProvider");
  return pay;
}

export function strongAuthApplies(r: RegionPack, usd: number, cardCheck = false): boolean {
  return cardCheck ? r.strongAuth.required && r.strongAuth.method !== "none" : needsStrongAuth(usd, r);
}

export function PaymentProvider({ personaId, company, run, children }: { personaId: string; company: string; run: Run; children: ReactNode }) {
  const { region } = useMoney();
  const [req, setReq] = useState<PayRequest | null>(null);
  const pay = useCallback<Pay>(
    (x) => {
      if (strongAuthApplies(region, x.usd, x.cardCheck)) {
        setReq(x);
        return;
      }
      const exempt = region.strongAuth.required && region.strongAuth.method !== "none";
      const total = fmtLocal(chargedTotal(x.usd, region), region);
      run((s) => x.apply(exempt ? recordPaymentAuth(s, personaId, "exempt", `${x.label} · ${total} is below the ${region.shortName} threshold`).state : s), x.okText);
    },
    [region, run, personaId],
  );
  return (
    <PayContext.Provider value={pay}>
      {children}
      {req && (
        <StrongAuthDialog
          region={region}
          company={company}
          req={req}
          onDecide={(ok, note) => {
            if (ok) run((s) => req.apply(recordPaymentAuth(s, personaId, "approved", note).state), req.okText);
            else run((s) => recordPaymentAuth(s, personaId, "cancelled", note).state, "Payment cancelled. Nothing was charged.");
            setReq(null);
          }}
        />
      )}
    </PayContext.Provider>
  );
}

/** The prompt a card payment shows in a region. The Brain opens it as a preview with no effect. */
export function StrongAuthDialog({ region: r, company, req, onDecide }: { region: RegionPack; company: string; req: Pick<PayRequest, "usd" | "label" | "cardCheck">; onDecide: (ok: boolean, note: string) => void }) {
  const b = taxBreakdown(req.usd, r);
  const amount = req.cardCheck ? "a card check" : fmtLocal(b.gross, r);
  const method = r.strongAuth.method === "otp" ? "One-time password" : "3-D Secure";
  const Icon = r.strongAuth.method === "otp" ? Smartphone : ShieldCheck;
  const decide = (ok: boolean) => onDecide(ok, `${req.label} · ${amount} · ${method}`);
  return (
    <Dialog open onOpenChange={(o) => !o && decide(false)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{r.strongAuth.title}</DialogTitle>
          <DialogDescription>{fillCopy(r.strongAuth.body, { amount, company })}</DialogDescription>
        </DialogHeader>
        {!req.cardCheck && (
          <dl className="space-y-1.5 rounded-lg border border-border p-3 type-body">
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">{req.label}</dt>
              <dd className="num">{fmtLocal(b.net, r)}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">
                {r.tax.name}
                {r.tax.rate != null ? ` ${Math.round(r.tax.rate * 100)}%` : ""}
              </dt>
              <dd className="num">{b.tax == null ? "On the invoice" : fmtLocal(b.tax, r)}</dd>
            </div>
            <div className="flex justify-between gap-3 border-t border-border pt-1.5 font-semibold">
              <dt>Total</dt>
              <dd className="num">{fmtLocal(b.gross, r)}</dd>
            </div>
          </dl>
        )}
        <div className="flex items-start gap-3 rounded-lg bg-muted p-3">
          <Icon aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
          <div className="min-w-0 type-body">
            <div className="font-medium">{method} · {r.name}</div>
            <p className="type-caption text-muted-foreground">{r.strongAuth.rule}</p>
          </div>
        </div>
        <DialogFooter className="gap-2">
          <Button variant="ghost" onClick={() => decide(false)}>
            {r.strongAuth.cancel}
          </Button>
          <Button onClick={() => decide(true)}>{r.strongAuth.approve}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** The region's tax display rule, shown under prices. */
export function TaxNote({ className }: { className?: string }) {
  const { region } = useMoney();
  return <p className={cn("type-caption text-muted-foreground", className)}>{region.tax.note}</p>;
}

/** Auto-renewal disclosure in the region's words. */
export function RenewalDisclosure({ planName, priceUsd, date, company, className }: { planName: string; priceUsd: number | null; date: string; company: string; className?: string }) {
  const { region, price } = useMoney();
  return (
    <div className={cn("rounded-xl border border-border bg-card p-4", className)}>
      <h3 className="type-body font-semibold">{region.autoRenewal.title}</h3>
      <p className="mt-1 type-body text-muted-foreground">{fillCopy(region.autoRenewal.body, { plan: planName, price: priceUsd == null ? "the agreed price" : price(priceUsd, 2), date, company })}</p>
    </div>
  );
}

/** Recurring-payment consent for auto top-up; required before it can be switched on in the region. */
export function RecurringConsent({ amountUsd, company, checked, onChange, error, region }: { amountUsd: number; company: string; checked: boolean; onChange: (v: boolean) => void; error?: string | null; region?: RegionPack }) {
  const money = useMoney();
  const r = region ?? money.region;
  const max = r.recurring.maxPerCharge != null ? fmtLocal(r.recurring.maxPerCharge, r) : "";
  const over = overMandateLimit(amountUsd, r);
  return (
    <div className="space-y-2 rounded-lg border border-border bg-muted/50 p-3">
      <div className="type-body font-medium">{r.recurring.title}</div>
      <p className="type-caption text-muted-foreground">{fillCopy(r.recurring.body, { company, amount: fmtLocal(chargedTotal(amountUsd, r), r), max })}</p>
      {over && <p className="type-caption text-watch-ink">This top-up is above {max}, so each charge will ask for a one-time password before it goes through.</p>}
      <div className="flex items-start gap-2">
        <Checkbox id={`recurring-consent-${r.id}`} checked={checked} onCheckedChange={(v) => onChange(v === true)} aria-describedby={error ? `recurring-consent-error-${r.id}` : undefined} aria-invalid={!!error} />
        <Label htmlFor={`recurring-consent-${r.id}`} className="font-normal leading-snug">
          {r.recurring.checkbox}
        </Label>
      </div>
      {error && (
        <p id={`recurring-consent-error-${r.id}`} role="alert" className="type-caption text-blocked-ink">
          {error}
        </p>
      )}
    </div>
  );
}
