// "Request credits" for Members without billing rights (Phase 2 §2.4): a prefilled reason,
// amount and cost, sent to the admins with a one-tap approve (simulated e-mail and chat).
import { useState, type FormEvent } from "react";
import { Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { meterOf, primaryMeter, requestCredits, topUpUnitPrice } from "@/core";
import { useMoney } from "@/ui/money";
import { useHub } from "@/surfaces/credits-hub/hub-context";

export interface RequestPrefill {
  meter?: string;
  amount: number;
  reason: string;
}

export function RequestCreditsDialog({ open, onOpenChange, prefill }: { open: boolean; onOpenChange: (v: boolean) => void; prefill: RequestPrefill }) {
  const { t, account, viewer, act } = useHub();
  const { fmtUsd } = useMoney();
  const pack = t.pack;
  const hub = t.hub[account];
  const [meter, setMeter] = useState(prefill.meter ?? primaryMeter(pack).id);
  const [amount, setAmount] = useState(String(Math.max(1, Math.ceil(prefill.amount))));
  const [reason, setReason] = useState(prefill.reason);
  const [error, setError] = useState<string | null>(null);
  const m = meterOf(pack, meter);
  const n = Number(amount);
  const approvers = hub.team.filter((x) => x.role === "admin" || x.role === "billing").map((x) => x.name);
  const where = [hub.alertChannels.email ? "e-mail" : null, hub.alertChannels.chat ? "team chat" : null, "the Hub"].filter(Boolean).join(", ");

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!Number.isFinite(n) || n <= 0) return setError(`Enter how many ${m.label} you need, as a number above zero.`);
    if (!reason.trim()) return setError("Add a line on what the credits are for, so the approver can decide quickly.");
    setError(null);
    act(
      (s) => requestCredits(s, account, { id: viewer.id, name: viewer.name }, meter, n, reason.trim()),
      () => ({ ok: true, text: `Request sent to ${approvers.join(" and ")} by ${where}.` }),
    );
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Request credits</DialogTitle>
            <DialogDescription>
              {approvers.join(" and ")} can approve this in one tap from {where}. Nothing is charged until they do.
            </DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-[1fr_auto] gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="rq-amount">Amount</Label>
              <Input id="rq-amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} aria-invalid={!!error && !(n > 0)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="rq-meter">Meter</Label>
              <NativeSelect id="rq-meter" value={meter} onChange={(e) => setMeter(e.target.value)}>
                {pack.meters.map((x) => (
                  <NativeSelectOption key={x.id} value={x.id}>
                    {x.label}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </div>
          </div>
          <p className="type-caption text-muted-foreground">
            About {fmtUsd(n > 0 ? n * topUpUnitPrice(pack, meter) : 0)} at the workspace's top-up price, if the balance doesn't already cover it.
          </p>
          <div className="space-y-1.5">
            <Label htmlFor="rq-reason">What it's for</Label>
            <Textarea id="rq-reason" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
          </div>
          {error && (
            <p role="alert" className="type-caption text-blocked-ink">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit">
              <Send aria-hidden="true" />
              Send request
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
