// Number, money and meter formatting shared by the brain and the UI.
import type { Meter } from "@/tenants/schema";

export const fmtNum = (n: number, digits = 0) => n.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: digits });
export const fmtUsd = (n: number, digits = 2) =>
  `${n < 0 ? "−" : ""}$${Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
export const fmtPct = (n: number, digits = 0) => `${(n * 100).toFixed(digits)}%`;
export const fmtDate = (iso: string | Date) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
export const fmtDateTime = (iso: string) => new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

/** An amount in a meter's own terms: "$4.20" for a currency meter, "1,500 Data Credits" otherwise. */
export function amountText(m: Meter, v: number, opts: { label?: boolean; digits?: number } = {}): string {
  const digits = opts.digits ?? m.decimals;
  if (m.valueType === "currency") return fmtUsd(v, Math.min(2, Math.max(digits, Math.abs(v) >= 100 ? 0 : 2)));
  const n = fmtNum(v, digits);
  return opts.label === false ? n : `${n} ${m.label}`;
}

/** Just the number for a meter, without its label ("$4.20" or "1,500"). */
export const amountNum = (m: Meter, v: number, digits?: number) => amountText(m, v, { label: false, digits });
