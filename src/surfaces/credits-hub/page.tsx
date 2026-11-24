import { isKilled } from "@/platform/release";
import { useCallback, useMemo, useState } from "react";
import { toast } from "sonner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { LiveStatus } from "@/components/live-status";
import { useCockpit, useTenant, type HubTab } from "@/lib/cockpit-store";
import type { TenantPack } from "@/tenants/schema";
import type { HubPersonaId } from "@/tenants/personas";
import { copy, cycleOf, fmtDate, planOf, ROLE_LABEL, setRegion, type TenantState } from "@/core";
import { MoneyProvider, moneyFor } from "@/ui/money";
import { REGIONS, regionById } from "@/tenants/regions";
import { PaymentProvider } from "@/surfaces/credits-hub/payments";
import { ToneBadge } from "@/ui/tone";
import { hubNav, visible } from "@/components/nav";
import { hubViewer } from "@/surfaces/credits-hub/viewer";
import { HubContext, type ActFn, type HubCtx, type RunFn } from "@/surfaces/credits-hub/hub-context";
import { HomeTab } from "@/surfaces/credits-hub/home";
import { UsageTab } from "@/surfaces/credits-hub/usage";
import { TablesTab } from "@/surfaces/credits-hub/tables";
import { TopUpsTab } from "@/surfaces/credits-hub/topups";
import { LimitsTab } from "@/surfaces/credits-hub/governance";
import { RewardsTab } from "@/surfaces/credits-hub/rewards";
import { PlanTab } from "@/surfaces/credits-hub/plan";
import { BillingTab, PaymentBanner } from "@/surfaces/credits-hub/billing";
import { LifecycleTab } from "@/surfaces/credits-hub/lifecycle";

export type { RunFn };

/** Scopes the tenant's brand accent to the white-labelled Credits Hub. Values are schema-validated colours. */
export function BrandStyle({ pack }: { pack: TenantPack }) {
  const a = pack.brand.accent;
  const sel = `[data-brand="${pack.id}"]`;
  const light = `--primary:${a.light};--primary-foreground:${a.foregroundLight};--ring:${a.light};--chart-1:${a.light};`;
  const dark = `--primary:${a.dark};--primary-foreground:${a.foregroundDark};--ring:${a.dark};--chart-1:${a.dark};`;
  return <style>{`${sel}{${light}} .dark ${sel}{${dark}} @media (prefers-color-scheme: dark){:root:not(.light) ${sel}{${dark}}}`}</style>;
}

export function CreditsHubPage({ personaId }: { personaId: HubPersonaId; viewer?: "owner" | "member" }) {
  const t = useTenant();
  const persona = useCockpit((s) => s.persona);
  const apply = useCockpit((s) => s.apply);
  const setUi = useCockpit((s) => s.setUi);
  const tab = useCockpit((s) => s.hubTab);
  const horizon = useCockpit((s) => s.horizon);
  const [said, setSaid] = useState({ n: 0, text: "" });
  const pack = t.pack;
  const account = personaId;
  const hub = t.hub[account];
  const viewer = useMemo(() => hubViewer(t, persona), [t, persona]);
  const plan = planOf(pack, hub.planId);
  const { start, end, day } = cycleOf(t);
  const tabs = visible(hubNav(pack, { can: viewer.can, lifecycle: account === "maya", member: viewer.role === "member" }), horizon, (k) => isKilled(t.platform, k));
  const current = tabs.find((x) => x.hubTab === tab)?.hubTab ?? tabs[0]?.hubTab ?? "home";
  const region = regionById(hub.region);
  const money = moneyFor(region);

  const announce = useCallback((ok: boolean, text: string) => {
    setSaid((s) => ({ n: s.n + 1, text }));
    if (ok) toast.success(text);
    else toast.error(text);
  }, []);

  const run: RunFn = useCallback(
    (fn, okText) => {
      const saved = apply(fn);
      announce(saved, saved ? okText : `${okText} Not saved in this browser.`);
    },
    [apply, announce],
  );

  const act: ActFn = useCallback(
    (fn, message) => {
      let out: ReturnType<typeof fn> | null = null;
      let ok = true;
      let text = "";
      const saved = apply((s: TenantState) => {
        out = fn(s);
        const m = message(out.result);
        ok = m?.ok ?? true;
        text = m?.text ?? "";
        return ok ? out.state : s;
      });
      if (text) announce(ok && saved, ok && !saved ? `${text} Not saved in this browser.` : text);
      return (out as { result: unknown } | null)?.result as never;
    },
    [apply, announce],
  );

  const ctx: HubCtx = { t, account, viewer, run, act, silent: apply, goTab: (id: HubTab) => setUi({ hubTab: id }) };

  return (
    <MoneyProvider region={region}>
      <PaymentProvider personaId={account} company={pack.company} run={run}>
        <HubContext.Provider value={ctx}>
          <div data-brand={pack.id} className="mx-auto max-w-[1400px] space-y-5 px-4 py-5 sm:px-6 sm:py-6">
            <BrandStyle pack={pack} />
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div className="flex min-w-0 items-center gap-3">
                <span aria-hidden="true" className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary text-base font-semibold text-primary-foreground">
                  {pack.brand.glyph}
                </span>
                <div className="min-w-0">
                  <h1 className="type-title">
                    {pack.brand.wordmark} · {copy(pack, "hub.title", "Credits Hub")}
                  </h1>
                  <p className="type-body text-muted-foreground">
                    {viewer.name} · {ROLE_LABEL[viewer.role]}
                    {viewer.isMemberPersona ? ` on ${hub.profile.company}` : ` · ${pack.demo.hub[account].role}`}
                  </p>
                </div>
              </div>
              <dl className="grid w-full grid-cols-2 gap-x-6 gap-y-1 type-body sm:w-auto sm:grid-flow-col sm:grid-cols-none sm:grid-rows-[auto_auto]">
                <dt className="type-caption text-muted-foreground">Plan</dt>
                <dd className="font-medium">
                  {plan.name}
                  {plan.price ? ` · ${money.price(plan.price, 0)}/mo` : ""}
                </dd>
                <dt className="type-caption text-muted-foreground">Cycle</dt>
                <dd className="font-medium num">
                  {fmtDate(start)} – {fmtDate(end)} · day {day + 1}
                </dd>
                <dt className="type-caption text-muted-foreground">Status</dt>
                <dd>
                  {hub.status === "active" && <ToneBadge tone="healthy">Active</ToneBadge>}
                  {hub.status === "paused" && <ToneBadge tone="neutral">Paused{hub.pause ? ` to ${fmtDate(hub.pause.until)}` : ""}</ToneBadge>}
                  {hub.status === "cancelling" && <ToneBadge tone="watch">Cancels {fmtDate(end)}</ToneBadge>}
                </dd>
                <dt className="type-caption text-muted-foreground">
                  <label htmlFor="hub-region">Billing region</label>
                </dt>
                <dd>
                  {viewer.can("payment") ? (
                    <NativeSelect
                      id="hub-region"
                      size="sm"
                      value={region.id}
                      onChange={(e) => {
                        const r = regionById(e.target.value);
                        run((s) => setRegion(s, account, r.id, r.name).state, `Billing region: ${r.name}. Prices in ${r.currency.code}.`);
                      }}
                    >
                      {REGIONS.map((r) => (
                        <NativeSelectOption key={r.id} value={r.id}>
                          {r.name} · {r.currency.code}
                        </NativeSelectOption>
                      ))}
                    </NativeSelect>
                  ) : (
                    <span id="hub-region" className="font-medium">
                      {region.name} · {region.currency.code}
                    </span>
                  )}
                </dd>
              </dl>
            </div>

            <PaymentBanner />

            <Tabs value={current} onValueChange={(v) => setUi({ hubTab: v as HubTab })}>
              <TabsList variant="line" aria-label="Account sections" className="w-full flex-nowrap overflow-x-auto lg:hidden">
                {tabs.map((x) => (
                  <TabsTrigger key={x.id} value={x.hubTab!}>
                    {x.label}
                  </TabsTrigger>
                ))}
              </TabsList>
              <h2 className="sr-only">{tabs.find((x) => x.hubTab === current)?.label}</h2>
              <TabsContent value="home" className="pt-4">
                <HomeTab />
              </TabsContent>
              <TabsContent value="usage" className="pt-4">
                <UsageTab />
              </TabsContent>
              <TabsContent value="tables" className="pt-4">
                <TablesTab />
              </TabsContent>
              <TabsContent value="topups" className="pt-4">
                <TopUpsTab />
              </TabsContent>
              <TabsContent value="limits" className="pt-4">
                <LimitsTab />
              </TabsContent>
              <TabsContent value="rewards" className="pt-4">
                <RewardsTab />
              </TabsContent>
              <TabsContent value="plan" className="pt-4">
                <PlanTab />
              </TabsContent>
              <TabsContent value="billing" className="pt-4">
                <BillingTab />
              </TabsContent>
              <TabsContent value="lifecycle" className="pt-4">
                <LifecycleTab />
              </TabsContent>
            </Tabs>
            <LiveStatus>{said.n > 0 ? `${said.text} (${said.n})` : ""}</LiveStatus>
          </div>
        </HubContext.Provider>
      </PaymentProvider>
    </MoneyProvider>
  );
}
