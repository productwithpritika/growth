// Brain → Regions: the region and policy packs (Phase 1 §1.7) side by side, applied to this
// tenant's prices, with previews of each prompt. Nothing here charges or collects card data.
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { SectionTitle } from "@/ui/primitives";
import { ToneBadge } from "@/ui/tone";
import { MoneyProvider } from "@/ui/money";
import { REGION_LOAD, REGIONS } from "@/tenants/regions";
import type { RegionPack } from "@/tenants/region-schema";
import { chargedTotal, fmtLocal, fmtPrice, priceSuffix } from "@/core/money";
import { packsFor, primaryMeter, type TenantState } from "@/core";
import { amountText } from "@/core/format";
import { HUB_PERSONAS } from "@/tenants/personas";
import { RecurringConsent, RenewalDisclosure, StrongAuthDialog, strongAuthApplies } from "@/surfaces/credits-hub/payments";

export function RegionsTab({ t }: { t: TenantState }) {
  const pack = t.pack;
  const m = primaryMeter(pack);
  const plan = pack.plans.find((p) => p.paid && p.price) ?? pack.plans[0];
  const topUp = packsFor(pack, m.id).slice(-1)[0] ?? null;
  const [prompt, setPrompt] = useState<RegionPack | null>(null);
  const failed = REGION_LOAD.filter((l) => !l.region);
  return (
    <section aria-labelledby="regions-title" className="space-y-4">
      <SectionTitle id="regions-title" aside={`${REGIONS.length} region packs · src/tenants/regions/*.json`}>
        Regions and payment policy
      </SectionTitle>
      <p className="type-body text-muted-foreground">
        Each Credits Hub account has a billing region. The region pack sets the currency, how tax is shown, when a card payment needs strong authentication, the consent copy for automatic charges and the auto-renewal disclosure. Prompts are simulated; no card details are collected.
      </p>
      {failed.length > 0 && (
        <ul className="rounded-lg border border-blocked bg-blocked-soft p-3 type-caption text-blocked-ink">
          {failed.map((f) => (
            <li key={f.file}>
              {f.file}: {f.issues.map((i) => `${i.path} ${i.message}`).join("; ")}
            </li>
          ))}
        </ul>
      )}
      <div className="grid gap-4 xl:grid-cols-3">
        {REGIONS.map((r) => {
          const here = HUB_PERSONAS.filter((id) => t.hub[id]?.region === r.id).map((id) => (id === "dev" ? "Dev" : "Maya"));
          const sca = strongAuthApplies(r, topUp?.price ?? 0);
          return (
            <MoneyProvider key={r.id} region={r}>
              <article aria-labelledby={`rg-${r.id}`} className="space-y-4 rounded-xl border border-border bg-card p-4">
                <header className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <h3 id={`rg-${r.id}`} className="type-heading">
                      {r.name}
                    </h3>
                    <p className="type-caption text-muted-foreground">
                      {r.currency.code} · {r.currency.locale} · {r.currency.perUsd === 1 ? "list prices" : `${r.currency.perUsd} per US dollar`}
                    </p>
                  </div>
                  <ToneBadge tone={here.length ? "info" : "neutral"}>{here.length ? `${here.join(", ")} bill here` : "No accounts here"}</ToneBadge>
                </header>
                <dl className="space-y-1.5 type-body">
                  <div className="flex justify-between gap-3">
                    <dt className="text-muted-foreground">{plan.name}</dt>
                    <dd className="num">
                      {fmtPrice(plan.price ?? 0, r, 0)}/mo <span className="type-caption text-muted-foreground">{priceSuffix(r)}</span>
                    </dd>
                  </div>
                  {topUp && (
                    <div className="flex justify-between gap-3">
                      <dt className="text-muted-foreground">{amountText(m, topUp.units)}</dt>
                      <dd className="num">
                        {fmtPrice(topUp.price, r)} <span className="type-caption text-muted-foreground">charged {fmtLocal(chargedTotal(topUp.price, r), r)}</span>
                      </dd>
                    </div>
                  )}
                  <div className="flex justify-between gap-3">
                    <dt className="text-muted-foreground">Tax</dt>
                    <dd>
                      {r.tax.name}
                      {r.tax.rate != null ? ` ${Math.round(r.tax.rate * 100)}%` : " by address"} · {r.tax.display}
                    </dd>
                  </div>
                </dl>
                <p className="type-caption text-muted-foreground">{r.tax.note}</p>
                <div className="space-y-2 border-t border-border pt-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h4 className="type-body font-semibold">Card payments</h4>
                    <ToneBadge tone={r.strongAuth.required ? "watch" : "neutral"}>{r.strongAuth.method === "otp" ? "One-time password" : r.strongAuth.method === "3ds" ? "3-D Secure" : "No extra step"}</ToneBadge>
                  </div>
                  <p className="type-caption text-muted-foreground">{r.strongAuth.rule}</p>
                  <Button size="xs" variant="outline" disabled={!r.strongAuth.required} onClick={() => setPrompt(r)}>
                    {r.strongAuth.required ? `Preview the prompt for ${topUp ? amountText(m, topUp.units) : "a top-up"}${sca ? "" : " (exempt at this amount)"}` : "No prompt in this region"}
                  </Button>
                </div>
                <div className="space-y-2 border-t border-border pt-3">
                  <h4 className="type-body font-semibold">Automatic charges</h4>
                  <RecurringConsent region={r} amountUsd={topUp?.price ?? 0} company={pack.company} checked={false} onChange={() => undefined} />
                </div>
                <RenewalDisclosure planName={plan.name} priceUsd={plan.price} date="the same day each month" company={pack.company} />
              </article>
            </MoneyProvider>
          );
        })}
      </div>
      {prompt && (
        <StrongAuthDialog
          region={prompt}
          company={pack.company}
          req={{ usd: Math.max(topUp?.price ?? 0, (prompt.strongAuth.exemptBelow ?? 0) / prompt.currency.perUsd), label: topUp ? `${amountText(m, topUp.units)} top-up` : "Top-up" }}
          onDecide={() => setPrompt(null)}
        />
      )}
    </section>
  );
}
