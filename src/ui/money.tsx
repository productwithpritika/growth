// Region-aware money for the customer-facing surfaces. The Credits Hub wraps itself in a
// MoneyProvider for the account's billing region; everything else (merchant views) defaults to US
// dollars. Components read formatters from useMoney() instead of the core USD helpers.
import { createContext, useContext, useMemo, type ReactNode } from "react";
import type { Meter } from "@/tenants/schema";
import type { RegionPack } from "@/tenants/region-schema";
import { amountText as usdAmountText } from "@/core/format";
import { chargedTotal, fmtLocal, fmtMoney, fmtPrice, localiseNote, priceSuffix, taxBreakdown } from "@/core/money";
import { regionById } from "@/tenants/regions";

const MoneyContext = createContext<RegionPack | null>(null);

export function MoneyProvider({ region, children }: { region: RegionPack; children: ReactNode }) {
  return <MoneyContext.Provider value={region}>{children}</MoneyContext.Provider>;
}

export interface Money {
  region: RegionPack;
  /** A USD amount in the region's currency (no tax). Same signature as the core fmtUsd. */
  fmtUsd: (usd: number, digits?: number) => string;
  /** A list price under the region's tax display (VAT-inclusive regions show the gross). */
  price: (usdNet: number, digits?: number) => string;
  /** "incl. VAT", "+ GST", "+ tax". */
  suffix: string;
  tax: (usdNet: number) => ReturnType<typeof taxBreakdown>;
  /** What a card is charged for a net USD amount, tax included where the region adds it. */
  charged: (usdNet: number) => string;
  amountText: (m: Meter, v: number, opts?: { label?: boolean; digits?: number }) => string;
  amountNum: (m: Meter, v: number, digits?: number) => string;
  /** Rewrite "$12.50" inside stored notes into the region's currency. */
  note: (text: string) => string;
}

export function moneyFor(region: RegionPack): Money {
  const amountText = (m: Meter, v: number, opts: { label?: boolean; digits?: number } = {}) => {
    if (m.valueType !== "currency") return usdAmountText(m, v, opts);
    const digits = opts.digits ?? m.decimals;
    return fmtMoney(v, region, Math.min(2, Math.max(digits, Math.abs(v) >= 100 ? 0 : 2)));
  };
  return {
    region,
    fmtUsd: (usd, digits = 2) => fmtMoney(usd, region, digits),
    price: (usd, digits) => fmtPrice(usd, region, digits),
    suffix: priceSuffix(region),
    tax: (usd) => taxBreakdown(usd, region),
    charged: (usd) => fmtLocal(chargedTotal(usd, region), region),
    amountText,
    amountNum: (m, v, digits) => amountText(m, v, { label: false, digits }),
    note: (text) => localiseNote(text, region),
  };
}

export function useMoney(): Money {
  const region = useContext(MoneyContext) ?? regionById("us");
  return useMemo(() => moneyFor(region), [region]);
}
