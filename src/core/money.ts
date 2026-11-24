// Region-aware money, as pure functions over a region pack. Tenant Packs price in US dollars
// (net of tax); a region converts, applies its tax display rule and decides whether a card
// payment needs strong authentication.
import type { RegionPack } from "@/tenants/region-schema";

export function convert(usd: number, r: RegionPack): number {
  return usd * r.currency.perUsd;
}

/** Format an amount already in the region's currency. */
export function fmtLocal(amount: number, r: RegionPack, digits?: number): string {
  let d = digits ?? r.currency.decimals;
  if (r.currency.decimals === 0 && (Math.abs(amount) >= 10 || amount === 0)) d = 0; // whole rupees for anything ≥ ₹10
  const s = Math.abs(amount).toLocaleString(r.currency.locale, { style: "currency", currency: r.currency.code, minimumFractionDigits: Math.min(d, 2), maximumFractionDigits: d });
  return amount < 0 ? `−${s}` : s;
}

/** A USD amount shown in the region's currency (balances, caps, list values). No tax applied. */
export function fmtMoney(usd: number, r: RegionPack, digits?: number): string {
  return fmtLocal(convert(usd, r), r, digits);
}

export interface TaxBreakdown {
  net: number; // region currency
  tax: number | null; // null when it depends on the billing address
  gross: number;
  label: string; // "incl. €3.25 VAT", "+ ₹2,797 GST", "+ sales tax where applicable"
}

/** Net USD → what the customer pays in the region, with the tax line. */
export function taxBreakdown(usdNet: number, r: RegionPack): TaxBreakdown {
  const net = convert(usdNet, r);
  if (r.tax.rate == null) return { net, tax: null, gross: net, label: `+ ${r.tax.name.toLowerCase()} where applicable` };
  const tax = net * r.tax.rate;
  const gross = net + tax;
  return { net, tax, gross, label: r.tax.display === "inclusive" ? `incl. ${fmtLocal(tax, r, r.currency.decimals)} ${r.tax.name}` : `+ ${fmtLocal(tax, r, r.currency.decimals)} ${r.tax.name}` };
}

/** How a list price reads: VAT-inclusive regions show the gross; others show net with a suffix. */
export function fmtPrice(usdNet: number, r: RegionPack, digits?: number): string {
  const b = taxBreakdown(usdNet, r);
  return fmtLocal(r.tax.display === "inclusive" ? b.gross : b.net, r, digits);
}

export function priceSuffix(r: RegionPack): string {
  if (r.tax.display === "inclusive") return `incl. ${r.tax.name}`;
  return r.tax.rate == null ? `+ tax` : `+ ${r.tax.name}`;
}

/** What a card is actually charged for a net USD amount. */
export function chargedTotal(usdNet: number, r: RegionPack): number {
  return taxBreakdown(usdNet, r).gross;
}

/** Whether a card payment needs strong authentication in this region. */
export function needsStrongAuth(usdNet: number, r: RegionPack): boolean {
  if (!r.strongAuth.required || r.strongAuth.method === "none") return false;
  const ex = r.strongAuth.exemptBelow;
  return ex == null || chargedTotal(usdNet, r) >= ex;
}

/** Whether an automatic (mandate) charge exceeds the region's per-charge limit. */
export function overMandateLimit(usdNet: number, r: RegionPack): boolean {
  const max = r.recurring.maxPerCharge;
  return max != null && chargedTotal(usdNet, r) > max;
}

/** Fill {placeholders} in region copy. */
export function fillCopy(text: string, vars: Record<string, string>): string {
  return text.replace(/\{(\w+)\}/g, (m, k: string) => vars[k] ?? m);
}

/** Rewrite "$12.50"-style amounts inside stored notes into the region's currency. */
export function localiseNote(text: string, r: RegionPack): string {
  if (r.currency.code === "USD") return text;
  return text.replace(/\$([0-9][0-9,]*(?:\.[0-9]+)?)/g, (_m, n: string) => fmtMoney(Number(n.replace(/,/g, "")), r));
}
