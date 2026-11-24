// The read-only usage view behind a share link (Phase 2 §2.2). Same explainer, no controls
// that change anything; expired or revoked links say so and point back.
import { useMemo } from "react";
import { Link, useParams } from "react-router-dom";
import { Eye } from "lucide-react";
import { ErrorState } from "@/components/states";
import { useCockpit } from "@/lib/cockpit-store";
import { fmtDate, runHistory, type TenantState } from "@/core";
import { regionById } from "@/tenants/regions";
import { MoneyProvider } from "@/ui/money";
import { HubContext, type HubCtx } from "@/surfaces/credits-hub/hub-context";
import { UsageExplainer } from "@/surfaces/credits-hub/usage";
import { BrandStyle } from "@/surfaces/credits-hub/page";
import { hubViewer } from "@/surfaces/credits-hub/viewer";

function findShare(tenants: Record<string, TenantState>, id: string) {
  for (const t of Object.values(tenants))
    for (const account of ["maya", "dev"] as const) {
      const link = t.hub[account]?.shares.find((s) => s.id === id);
      if (link) return { t, account, link };
    }
  return null;
}

export function SharedUsagePage() {
  const { id = "" } = useParams();
  const tenants = useCockpit((s) => s.data.tenants);
  const found = useMemo(() => findShare(tenants, id), [tenants, id]);
  if (!found)
    return (
      <div className="mx-auto max-w-xl px-4 py-10">
        <ErrorState title="This link doesn't open anything" description="It may have been typed wrong, or it was made in another browser. Ask whoever shared it for a new link." />
      </div>
    );
  const { t, account, link } = found;
  const expired = new Date(link.expiresAt) <= new Date(t.clock);
  if (link.revoked || expired)
    return (
      <div className="mx-auto max-w-xl px-4 py-10">
        <ErrorState title={link.revoked ? "Access to this view was turned off" : "This link has expired"} description={`It was shared on ${fmtDate(link.ts)}${link.revoked ? " and revoked since" : ` and expired on ${fmtDate(link.expiresAt)}`}. Ask for a new one if you still need it.`} />
      </div>
    );
  const ctx: HubCtx = { t, account, viewer: { ...hubViewer(t, account), can: () => false }, run: () => undefined, act: () => undefined, silent: () => false, goTab: () => undefined };
  const runs = runHistory(t, account, link.days);
  return (
    <MoneyProvider region={regionById(t.hub[account].region)}>
      <HubContext.Provider value={ctx}>
        <div data-brand={t.pack.id} className="mx-auto max-w-[1200px] space-y-5 px-4 py-6 sm:px-6">
          <BrandStyle pack={t.pack} />
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h1 className="type-title">
                {t.pack.brand.wordmark} usage · {t.hub[account].profile.company}
              </h1>
              <p className="flex items-center gap-1.5 type-body text-muted-foreground">
                <Eye aria-hidden="true" className="size-4" />
                Read-only view of the last {link.days} days, shared {fmtDate(link.ts)}, open until {fmtDate(link.expiresAt)}.
              </p>
            </div>
            <Link to="/" className="type-body text-primary underline underline-offset-2">
              Back to the Credits Hub
            </Link>
          </div>
          <UsageExplainer runs={runs} days={link.days} dim="table" readOnly />
        </div>
      </HubContext.Provider>
    </MoneyProvider>
  );
}
