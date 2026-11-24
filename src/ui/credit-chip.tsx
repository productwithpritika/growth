import type { Meter } from "@/tenants/schema";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useMoney } from "@/ui/money";
import { cn } from "@/lib/utils";

const GLYPH: Record<Meter["valueType"], string> = { credits: "◆", actions: "▸", currency: "$" };

/** An amount of one meter, with the unit explained on hover or focus. */
export function CreditChip({ meter, amount, signed, className }: { meter: Meter; amount: number; signed?: boolean; className?: string }) {
  const { amountText, fmtUsd, region } = useMoney();
  const text = amountText(meter, Math.abs(amount));
  const sign = signed ? (amount > 0 ? "+" : amount < 0 ? "−" : "") : "";
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          className={cn(
            "inline-flex items-center gap-1 rounded-md border border-border bg-card px-1.5 py-0.5 type-caption font-medium num focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
            signed && amount > 0 && "text-healthy-ink",
            className,
          )}
        >
          <span aria-hidden="true" className="text-muted-foreground">{GLYPH[meter.valueType]}</span>
          {sign}
          {text}
        </button>
      </TooltipTrigger>
      <TooltipContent className="max-w-64">
        <span className="font-semibold">{meter.label}</span>
        {meter.valueType === "currency" ? ` · prepaid balance in ${region.currency.code}` : ` · list ${fmtUsd(meter.pricePerUnit, meter.pricePerUnit < 0.01 ? 4 : 3)} per ${meter.unit.replace(/s$/, "")}`}
        {meter.hint ? `. ${meter.hint}` : ""}
      </TooltipContent>
    </Tooltip>
  );
}
