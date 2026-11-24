import type { Meter } from "@/tenants/schema";
import type { TenantState } from "@/core/types";
import { useMoney } from "@/ui/money";
import { CYCLE_DAYS, addDays, cycleOf, daysText, fmtDay } from "@/core/time";
import { grantRule, planOf } from "@/core/pack";
import { meterTimeline } from "@/core/forecasting";
import { Button } from "@/components/ui/button";
import { MeterBar } from "@/ui/meter-bar";
import { ForecastLine } from "@/ui/forecast-line";
import { ToneBadge } from "@/ui/tone";

/** One meter's balance: the number, its status, the used/held/remaining bar and the forecast. */
export function BalanceCard({ t, personaId, meter, onTopUp, compact }: { t: TenantState; personaId: string; meter: Meter; onTopUp?: () => void; compact?: boolean }) {
  const { amountText } = useMoney();
  const tl = meterTimeline(t, personaId, meter.id);
  const { start, end, day } = cycleOf(t);
  const plan = planOf(t.pack, t.hub[personaId].planId);
  const rule = grantRule(t.pack, plan.id, meter.id);
  const titleId = `bal-${personaId}-${meter.id}`;
  const summaryId = `${titleId}-summary`;
  const pctLeft = tl.available > 0 ? tl.balance / tl.available : 0;
  const status = tl.ranOutAt
    ? { tone: "blocked" as const, text: `Ran out ${fmtDay(tl.ranOutAt)}` }
    : tl.runsOutDay != null
      ? { tone: "atRisk" as const, text: `Runs out ${fmtDay(addDays(start, tl.runsOutDay))}` }
      : pctLeft < 0.2
        ? { tone: "watch" as const, text: `${Math.round(pctLeft * 100)}% left` }
        : { tone: "healthy" as const, text: "Covers the cycle" };
  const range =
    tl.runsOutEarly != null && tl.runsOutLate != null && tl.runsOutEarly !== tl.runsOutLate
      ? ` (80% range ${fmtDay(addDays(start, tl.runsOutEarly))}–${fmtDay(addDays(start, tl.runsOutLate))})`
      : "";
  const rate = amountText(meter, tl.rate, { label: false, digits: meter.valueType === "currency" ? 2 : 0 });
  const summary = tl.ranOutAt
    ? `${amountText(meter, tl.used)} of ${amountText(meter, tl.available)} used. Ran out on ${fmtDay(tl.ranOutAt)}; resets ${fmtDay(end)}.`
    : tl.runsOutDay != null
      ? `At ${rate} a day this runs out on ${fmtDay(addDays(start, tl.runsOutDay))}${range}, ${daysText(CYCLE_DAYS - tl.runsOutDay)} before reset.`
      : `At ${rate} a day the balance lasts to reset on ${fmtDay(end)}.`;
  const cadence = rule.cadence === "daily" ? `${amountText(meter, plan.included[meter.id] ?? 0)} a day${rule.monthlyCap ? `, up to ${amountText(meter, rule.monthlyCap, { label: false })} a month` : ""}` : null;
  const foot = [cadence, rule.rollover.mode === "full" ? "Rolls over in full" : rule.rollover.mode === "capped" && plan.paid ? `Up to ${rule.rollover.capX}× the allowance rolls over` : `Resets ${fmtDay(end)}`].filter(Boolean).join(" · ");

  return (
    <section aria-labelledby={titleId} className="flex min-w-0 flex-col gap-3 rounded-xl border border-border bg-card p-4 sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id={titleId} className="type-body font-semibold">{meter.label}</h2>
          <div className="mt-1 flex flex-wrap items-baseline gap-x-2">
            <span className="type-display">{amountText(meter, tl.balance, { label: false })}</span>
            <span className="type-body text-muted-foreground">left of {amountText(meter, tl.available, { label: false })}</span>
          </div>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-2">
          <ToneBadge tone={status.tone}>{status.text}</ToneBadge>
          {onTopUp && (
            <Button size="sm" variant="outline" onClick={onTopUp}>
              {meter.valueType === "currency" ? "Add funds" : "Top up"}
            </Button>
          )}
        </div>
      </div>
      <MeterBar meter={meter} used={tl.used} held={tl.held} remaining={tl.balance} expiring={tl.expiring.amount} />
      <p id={summaryId} className="type-body text-muted-foreground">{summary}</p>
      {!compact && <ForecastLine meter={meter} timeline={tl} today={day} titleId={titleId} summaryId={summaryId} />}
      <p className="type-caption text-muted-foreground">{foot}</p>
    </section>
  );
}
