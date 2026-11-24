// Embed SDK (Phase 7 §7.6): a web component and script snippet so the tenant can embed Credits Hub
// modules in its own app as a drawer or modal (not an iframe), themed from the Tenant Pack, with a
// single sign-on token and event hooks. A mock tenant app shows it in both hosted and embedded mode.
import { useMemo, useState } from "react";
import { Copy, ExternalLink, PanelRight, SquareStack, Table2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { SectionTitle } from "@/ui/primitives";
import { BalanceCard } from "@/ui/balance-card";
import { ToneBadge } from "@/ui/tone";
import { fmtNum, fmtUsd } from "@/core/format";
import { fnv1a } from "@/core/time";
import { planOf } from "@/core/pack";
import { personaName } from "@/tenants/personas";
import { evaluateMoment, liveDef } from "@/platform/moments";
import { usePlatform } from "@/surfaces/platform/use-platform";
import type { EmbedState } from "@/platform/types";
import { snippet } from "@/platform/embed";
import type { TenantState } from "@/core/types";

export const EMBED_MODULES: { id: string; label: string }[] = [
  { id: "balance", label: "Balance and forecast" },
  { id: "topups", label: "Top-ups" },
  { id: "plan", label: "Plan" },
  { id: "moments", label: "Moments" },
];
const HOOKS = ["onMomentShown", "onTopupStarted", "onPlanChanged"];

const setEmbed = (patch: Partial<EmbedState>) => (s: TenantState): TenantState => ({ ...s, platform: { ...s.platform, embed: { ...s.platform.embed, ...patch } } });

export function EmbedPanel() {
  const { t, run } = usePlatform();
  const e = t.platform.embed;
  const [open, setOpen] = useState(false);
  const [events, setEvents] = useState<{ n: number; name: string; detail: string }[]>([]);
  // A placeholder: the real token is minted per session by the tenant's server and never shown.
  const sso = useMemo(() => `{session token for ${t.packId}/dev, ref ${fnv1a(`${t.packId}|dev|${t.clock.slice(0, 10)}`).slice(0, 6)}}`, [t.packId, t.clock]);
  const code = snippet(t.packId, e, t.pack.brand.accent.light, sso);
  const fire = (name: string, detail: string) => {
    if (!e.hooks.includes(name)) return;
    setEvents((x) => [{ n: Date.now() + x.length, name, detail }, ...x].slice(0, 12));
  };
  const openHub = () => {
    setOpen(true);
    const m = t.platform.portal.moments.map((x) => liveDef(x)).filter((d): d is NonNullable<typeof d> => !!d && evaluateMoment(t, d, "dev").fires);
    if (e.modules.includes("moments")) for (const d of m) fire("onMomentShown", `${d.id} v${d.version}`);
  };
  const toggle = (list: string[], id: string, on: boolean) => (on ? [...new Set([...list, id])] : list.filter((x) => x !== id));
  return (
    <div className="grid gap-6 xl:grid-cols-[380px_minmax(0,1fr)]">
      <section aria-labelledby="emb-cfg" className="min-w-0 space-y-4 rounded-xl border border-border bg-card p-4">
        <h3 id="emb-cfg" className="type-heading">Configure the embed</h3>
        <fieldset className="space-y-1.5">
          <legend className="type-caption font-medium">Modules</legend>
          {EMBED_MODULES.map((m) => (
            <label key={m.id} className="flex items-center gap-2 type-body">
              <Checkbox checked={e.modules.includes(m.id)} onCheckedChange={(v) => run(setEmbed({ modules: toggle(e.modules, m.id, !!v) }), "Embed updated.", true)} />
              {m.label}
            </label>
          ))}
        </fieldset>
        <fieldset className="space-y-1.5">
          <legend className="type-caption font-medium">Opens as</legend>
          <div role="radiogroup" aria-label="Opens as" className="inline-flex rounded-md border border-border p-0.5">
            {(["drawer", "modal"] as const).map((m) => (
              <button key={m} type="button" role="radio" aria-checked={e.mode === m} onClick={() => run(setEmbed({ mode: m }), "Embed updated.", true)} className={`rounded px-3 py-1 type-caption font-medium focus-visible:outline-2 focus-visible:outline-ring ${e.mode === m ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}>
                {m === "drawer" ? "Drawer" : "Modal"}
              </button>
            ))}
          </div>
        </fieldset>
        <fieldset className="space-y-1.5">
          <legend className="type-caption font-medium">Event hooks</legend>
          {HOOKS.map((h) => (
            <label key={h} className="flex items-center gap-2 font-mono type-caption">
              <Checkbox checked={e.hooks.includes(h)} onCheckedChange={(v) => run(setEmbed({ hooks: toggle(e.hooks, h, !!v) }), "Embed updated.", true)} />
              {h}
            </label>
          ))}
        </fieldset>
        <div className="space-y-1 type-caption">
          <div className="font-medium">Theme</div>
          <div className="flex items-center gap-2">
            <span aria-hidden="true" className="size-4 rounded" style={{ background: t.pack.brand.accent.light }} />
            From the {t.pack.company} Tenant Pack
          </div>
          <div className="font-medium">Single sign-on</div>
          <p className="text-muted-foreground">The tenant's server mints a short-lived token for the signed-in user; the hub never sees a password. Preview: <span className="font-mono">{sso}</span></p>
        </div>
        <div className="space-y-1">
          <div className="flex items-center justify-between">
            <Label htmlFor="emb-code" className="type-caption font-medium">Snippet</Label>
            <Button size="xs" variant="ghost" onClick={() => void navigator.clipboard?.writeText(code).then(() => toast.success("Copied."), () => toast.error("Copy failed."))}>
              <Copy aria-hidden="true" />
              Copy
            </Button>
          </div>
          <pre id="emb-code" tabIndex={0} className="max-h-72 overflow-auto rounded-md bg-muted p-2 font-mono text-[11px] leading-relaxed">{code}</pre>
        </div>
      </section>
      <section aria-labelledby="emb-mock" className="min-w-0 space-y-3">
        <SectionTitle
          id="emb-mock"
          aside={
            <div role="radiogroup" aria-label="Hosted or embedded" className="inline-flex rounded-md border border-border p-0.5">
              {(["embedded", "hosted"] as const).map((m) => (
                <button key={m} type="button" role="radio" aria-checked={e.hosting === m} onClick={() => run(setEmbed({ hosting: m }), "Embed updated.", true)} className={`rounded px-3 py-1 type-caption font-medium focus-visible:outline-2 focus-visible:outline-ring ${e.hosting === m ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}>
                  {m === "embedded" ? "Embedded" : "Hosted"}
                </button>
              ))}
            </div>
          }
        >
          {t.pack.company} app (mock)
        </SectionTitle>
        {e.hosting === "embedded" ? (
          <div className="overflow-hidden rounded-xl border border-border bg-background shadow-sm">
            <div className="flex items-center justify-between border-b border-border bg-muted/50 px-4 py-2">
              <div className="flex items-center gap-2 type-body font-semibold">
                <span aria-hidden="true" className="flex size-6 items-center justify-center rounded text-xs text-white" style={{ background: t.pack.brand.accent.light }}>
                  {t.pack.brand.glyph}
                </span>
                {t.pack.brand.wordmark}
                <span className="font-normal text-muted-foreground">· {personaName(t.pack, "dev")}'s workspace</span>
              </div>
              <Button size="sm" onClick={openHub}>
                {e.mode === "drawer" ? <PanelRight aria-hidden="true" /> : <SquareStack aria-hidden="true" />}
                Credits
              </Button>
            </div>
            <div className="space-y-2 p-4">
              <div className="flex items-center gap-2 type-body font-medium">
                <Table2 aria-hidden="true" className="size-4" />
                {t.pack.demo.hub.dev.table?.name ?? "Table"}
              </div>
              <div className="grid grid-cols-4 gap-px overflow-hidden rounded-md border border-border bg-border type-caption">
                {["Company", "Domain", "Status", "Owner"].map((h) => (
                  <div key={h} className="bg-muted px-2 py-1 font-medium">{h}</div>
                ))}
                {Array.from({ length: 12 }, (_, i) => (
                  <div key={i} className="bg-card px-2 py-1 text-muted-foreground">{["Northwind Labs", "northwind.example", "Enriched", "Dev"][i % 4]}</div>
                ))}
              </div>
              <p className="type-caption text-muted-foreground">The app's own UI. "Credits" opens the hub modules in a {e.mode} inside the page, not an iframe.</p>
            </div>
          </div>
        ) : (
          <div className="overflow-hidden rounded-xl border border-border bg-background shadow-sm">
            <div className="flex items-center gap-2 border-b border-border bg-muted/50 px-3 py-1.5 font-mono type-caption text-muted-foreground">
              <ExternalLink aria-hidden="true" className="size-3.5" />
              billing.{t.packId}.example/credits
            </div>
            <div className="p-4">
              <Modules onEvent={fire} />
            </div>
          </div>
        )}
        <section aria-labelledby="ev-h" className="space-y-2 rounded-xl border border-border bg-card p-4">
          <h3 id="ev-h" className="type-body font-semibold">Events received by the host app</h3>
          {events.length === 0 ? (
            <p className="type-caption text-muted-foreground">None yet. Open Credits and use a module.</p>
          ) : (
            <ol aria-live="polite" className="space-y-1 font-mono type-caption">
              {events.map((x) => (
                <li key={x.n}>
                  {x.name}({x.detail})
                </li>
              ))}
            </ol>
          )}
        </section>
      </section>
      {e.mode === "drawer" ? (
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetContent className="w-full overflow-y-auto sm:max-w-md">
            <SheetHeader>
              <SheetTitle>Credits</SheetTitle>
              <SheetDescription>Embedded Credits Hub modules for {personaName(t.pack, "dev")}</SheetDescription>
            </SheetHeader>
            <div className="px-4 pb-6">
              <Modules onEvent={fire} />
            </div>
          </SheetContent>
        </Sheet>
      ) : (
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>Credits</DialogTitle>
              <DialogDescription>Embedded Credits Hub modules for {personaName(t.pack, "dev")}</DialogDescription>
            </DialogHeader>
            <Modules onEvent={fire} />
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

/** The embeddable modules, rendered from the live tenant for the signed-in account (Dev). */
function Modules({ onEvent }: { onEvent: (name: string, detail: string) => void }) {
  const { t } = usePlatform();
  const e = t.platform.embed;
  const prim = t.pack.meters[0];
  const plan = planOf(t.pack, t.hub.dev.planId);
  const moments = t.platform.portal.moments.map((x) => liveDef(x)).filter((d): d is NonNullable<typeof d> => !!d).map((d) => ({ d, ev: evaluateMoment(t, d, "dev") })).filter((x) => x.ev.fires);
  if (!e.modules.length) return <p className="type-body text-muted-foreground">No modules selected.</p>;
  return (
    <div className="space-y-4" data-embed="credits-hub">
      {e.modules.includes("moments") && moments.map(({ d, ev }) => (
        <div key={d.id} className="rounded-lg border-l-4 border border-border p-3" style={{ borderLeftColor: t.pack.brand.accent.light }}>
          <div className="type-body font-semibold">{ev.headline}</div>
          <p className="type-caption text-muted-foreground">{d.blocks.find((b) => b.kind === "body")?.text}</p>
        </div>
      ))}
      {e.modules.includes("balance") && <BalanceCard t={t} personaId="dev" meter={prim} compact onTopUp={() => onEvent("onTopupStarted", `${prim.id}`)} />}
      {e.modules.includes("topups") && (
        <div className="space-y-2">
          <div className="type-body font-semibold">Top up {prim.label}</div>
          <div className="grid grid-cols-2 gap-2">
            {t.pack.topUpPacks.filter((p) => p.meter === prim.id && !p.proposed).slice(0, 4).map((p) => (
              <Button key={p.id} variant="outline" className="h-auto flex-col items-start py-2" onClick={() => { onEvent("onTopupStarted", `${p.id}, ${fmtUsd(p.price)}`); toast.success(`Checkout started for ${fmtNum(p.units)} ${prim.label}. The host app was notified.`); }}>
                <span className="font-semibold">{fmtNum(p.units)} {prim.label}</span>
                <span className="type-caption text-muted-foreground">{fmtUsd(p.price)}</span>
              </Button>
            ))}
          </div>
        </div>
      )}
      {e.modules.includes("plan") && (
        <div className="flex items-center justify-between gap-2 rounded-lg border border-border p-3">
          <div>
            <div className="type-body font-semibold">{plan.name}</div>
            <div className="type-caption text-muted-foreground">{plan.highlights[0]}</div>
          </div>
          <Button size="sm" variant="outline" onClick={() => { const next = t.pack.plans.find((p) => p.paid && !p.proposed && (p.price ?? 0) > (plan.price ?? 0)); onEvent("onPlanChanged", `${plan.id} → ${next?.id ?? plan.id} (preview)`); toast.message(next ? `Plan change to ${next.name} previewed. The host app was notified.` : "Already on the top self-serve plan."); }}>
            Change plan
          </Button>
        </div>
      )}
      <ToneBadge tone="neutral">Rendered in the page · theme from the Tenant Pack</ToneBadge>
    </div>
  );
}
