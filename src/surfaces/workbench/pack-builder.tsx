// Pack Builder (Phase 8 §8.1): choose an archetype, define meters, grants, rollover, top-ups,
// limits and rewards, and watch a Credits Hub preview reconfigure from the draft pack. Pack lint
// flags risky configurations; a clean pack loads as a new tenant after approval.
import { useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, Rocket } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { SectionTitle } from "@/ui/primitives";
import { ToneBadge } from "@/ui/tone";
import { MeterBar } from "@/ui/meter-bar";
import { ApprovalSheet } from "@/ui/approval-sheet";
import { fmtNum, fmtUsd } from "@/core/format";
import { parsePack, type TenantPack } from "@/tenants/schema";
import { builtInPack, TENANT_PACKS } from "@/tenants/registry";
import { REGIONS } from "@/tenants/regions";
import { useCockpit, useTenantList } from "@/lib/cockpit-store";
import { usePlatform } from "@/surfaces/platform/use-platform";
import { ARCHETYPES, breakagePerAccount, draftFromPack, lintPack, packFromDraft, rewardCapPerAccount, slug, type Archetype, type BuilderDraft } from "@/platform/packs";

const regionIds = REGIONS.map((r) => r.id);

export function PackBuilder() {
  const { who } = usePlatform();
  const addTenant = useCockpit((s) => s.addTenant);
  const tenants = useTenantList();
  const [arch, setArch] = useState<Archetype>("seat-plus-usage");
  const base = builtInPack(ARCHETYPES.find((a) => a.id === arch)!.base) ?? TENANT_PACKS[0];
  const [draft, setDraft] = useState<BuilderDraft>(() => ({ ...draftFromPack(base, arch), company: "Northwind Teams" }));
  const [sheet, setSheet] = useState(false);
  const pick = (a: Archetype) => {
    setArch(a);
    const b = builtInPack(ARCHETYPES.find((x) => x.id === a)!.base) ?? TENANT_PACKS[0];
    setDraft({ ...draftFromPack(b, a), company: draft.company });
  };
  const id = slug(draft.company);
  const candidate = useMemo(() => packFromDraft(base, draft, id), [base, draft, id]);
  const parsed = useMemo(() => parsePack(candidate), [candidate]);
  const pack: TenantPack | null = parsed.ok ? parsed.pack : null;
  const lint = useMemo(() => (pack ? lintPack(pack, regionIds) : []), [pack]);
  const taken = tenants.some((x) => x.id === id);
  const errors = lint.filter((l) => l.level === "error");
  const set = (patch: Partial<BuilderDraft>) => setDraft((d) => ({ ...d, ...patch }));
  const prim = draft.meters[0];
  const load = () => {
    if (!pack) return;
    const a = addTenant(pack, { title: `Load ${pack.company} from the Pack Builder`, actor: who, decision: "approved", risk: lint.length ? "medium" : "low", summary: `${ARCHETYPES.find((x) => x.id === arch)?.label} · ${pack.plans.length} plans · ${lint.length} lint warnings` });
    setSheet(false);
    toast.success(a ? `${pack.company} loaded. Switch to it from the tenant menu.` : "Couldn't load the pack.");
  };
  return (
    <div className="space-y-6">
      <section aria-labelledby="arch-h" className="space-y-3">
        <SectionTitle id="arch-h">1. Archetype</SectionTitle>
        <div role="radiogroup" aria-label="Archetype" className="grid gap-2 md:grid-cols-2 xl:grid-cols-4">
          {ARCHETYPES.map((a) => (
            <button key={a.id} type="button" role="radio" aria-checked={arch === a.id} onClick={() => pick(a.id)} className={`rounded-xl border p-3 text-left focus-visible:outline-2 focus-visible:outline-ring ${arch === a.id ? "border-primary bg-primary/5" : "border-border bg-card hover:bg-muted"}`}>
              <div className="type-body font-semibold">{a.label}</div>
              <div className="type-caption text-muted-foreground">{a.blurb}</div>
            </button>
          ))}
        </div>
      </section>
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_420px]">
        <section aria-labelledby="def-h" className="space-y-5 rounded-xl border border-border bg-card p-4">
          <h3 id="def-h" className="type-heading">2. Define it</h3>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="pb-co">Company</Label>
              <Input id="pb-co" value={draft.company} onChange={(e) => set({ company: e.target.value })} />
              <p className="type-caption text-muted-foreground">Tenant id: {id}{taken ? " (already loaded: change the name)" : ""}</p>
            </div>
          </div>
          <fieldset className="space-y-2">
            <legend className="type-body font-semibold">Meters</legend>
            {draft.meters.map((m, i) => (
              <div key={m.id} className="grid grid-cols-[minmax(0,1fr)_140px] gap-2">
                <div className="space-y-1">
                  <Label htmlFor={`pb-m-${m.id}`} className="type-caption">Meter {i + 1} label</Label>
                  <Input id={`pb-m-${m.id}`} value={m.label} onChange={(e) => set({ meters: draft.meters.map((x) => (x.id === m.id ? { ...x, label: e.target.value } : x)) })} />
                </div>
                <div className="space-y-1">
                  <Label htmlFor={`pb-mp-${m.id}`} className="type-caption">Price per unit (USD)</Label>
                  <Input id={`pb-mp-${m.id}`} type="number" step="0.001" min={0} value={m.price} onChange={(e) => set({ meters: draft.meters.map((x) => (x.id === m.id ? { ...x, price: Number(e.target.value) } : x)) })} />
                </div>
              </div>
            ))}
          </fieldset>
          <fieldset className="space-y-2">
            <legend className="type-body font-semibold">Plans and grants ({prim?.label})</legend>
            {draft.plans.map((p) => (
              <div key={p.id} className="grid grid-cols-[minmax(0,1fr)_110px_130px] gap-2">
                <div className="space-y-1">
                  <Label htmlFor={`pb-pn-${p.id}`} className="type-caption">Plan</Label>
                  <Input id={`pb-pn-${p.id}`} value={p.name} onChange={(e) => set({ plans: draft.plans.map((x) => (x.id === p.id ? { ...x, name: e.target.value } : x)) })} />
                </div>
                <div className="space-y-1">
                  <Label htmlFor={`pb-pp-${p.id}`} className="type-caption">Price</Label>
                  <Input id={`pb-pp-${p.id}`} type="number" min={0} value={p.price ?? ""} placeholder="Contact" onChange={(e) => set({ plans: draft.plans.map((x) => (x.id === p.id ? { ...x, price: e.target.value === "" ? null : Number(e.target.value) } : x)) })} />
                </div>
                <div className="space-y-1">
                  <Label htmlFor={`pb-pi-${p.id}`} className="type-caption">Included a month</Label>
                  <Input id={`pb-pi-${p.id}`} type="number" min={0} value={p.included} onChange={(e) => set({ plans: draft.plans.map((x) => (x.id === p.id ? { ...x, included: Number(e.target.value) } : x)) })} />
                </div>
              </div>
            ))}
          </fieldset>
          <fieldset className="grid gap-3 sm:grid-cols-3">
            <legend className="mb-2 type-body font-semibold">Rollover and expiry (paid plans)</legend>
            <div className="space-y-1">
              <Label htmlFor="pb-ro" className="type-caption">Rollover</Label>
              <NativeSelect id="pb-ro" value={draft.rollover.mode} onChange={(e) => set({ rollover: { ...draft.rollover, mode: e.target.value as BuilderDraft["rollover"]["mode"] } })}>
                <NativeSelectOption value="none">None</NativeSelectOption>
                <NativeSelectOption value="capped">Capped</NativeSelectOption>
                <NativeSelectOption value="full">Full</NativeSelectOption>
              </NativeSelect>
            </div>
            <div className="space-y-1">
              <Label htmlFor="pb-rx" className="type-caption">Cap (× monthly grant)</Label>
              <Input id="pb-rx" type="number" min={0} step={0.5} value={draft.rollover.capX} disabled={draft.rollover.mode !== "capped"} onChange={(e) => set({ rollover: { ...draft.rollover, capX: Number(e.target.value) } })} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="pb-ex" className="type-caption">Credits expire after (days)</Label>
              <Input id="pb-ex" type="number" min={0} value={draft.expiryDays ?? ""} placeholder="Never" onChange={(e) => set({ expiryDays: e.target.value === "" ? null : Number(e.target.value) })} />
            </div>
          </fieldset>
          <fieldset className="space-y-2">
            <legend className="type-body font-semibold">Top-up packs</legend>
            {draft.topUps.map((p, i) => (
              <div key={i} className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <Label htmlFor={`pb-tu-${i}`} className="type-caption">Units</Label>
                  <Input id={`pb-tu-${i}`} type="number" min={0} value={p.units} onChange={(e) => set({ topUps: draft.topUps.map((x, j) => (j === i ? { ...x, units: Number(e.target.value) } : x)) })} />
                </div>
                <div className="space-y-1">
                  <Label htmlFor={`pb-tp-${i}`} className="type-caption">Price (USD)</Label>
                  <Input id={`pb-tp-${i}`} type="number" min={0} value={p.price} onChange={(e) => set({ topUps: draft.topUps.map((x, j) => (j === i ? { ...x, price: Number(e.target.value) } : x)) })} />
                </div>
              </div>
            ))}
          </fieldset>
          <fieldset className="space-y-2">
            <legend className="type-body font-semibold">Limits</legend>
            <div className="flex items-center gap-2">
              <Switch id="pb-neg" checked={draft.allowNegative} onCheckedChange={(v) => set({ allowNegative: v })} />
              <Label htmlFor="pb-neg" className="font-normal">Allow a negative balance</Label>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              <div className="space-y-1">
                <Label htmlFor="pb-od" className="type-caption">Overdraft cap (0 = no cap)</Label>
                <Input id="pb-od" type="number" min={0} value={draft.overdraftCap} disabled={!draft.allowNegative} onChange={(e) => set({ overdraftCap: Number(e.target.value) })} />
              </div>
              <div className="flex items-center gap-2 pt-5">
                <Switch id="pb-cap" checked={draft.selfSetCap} onCheckedChange={(v) => set({ selfSetCap: v })} />
                <Label htmlFor="pb-cap" className="font-normal">Customers can set their own spend cap</Label>
              </div>
            </div>
          </fieldset>
          <fieldset className="space-y-2">
            <legend className="type-body font-semibold">Rewards</legend>
            {draft.rewards.map((r, i) => (
              <div key={i} className="grid grid-cols-[minmax(0,1fr)_120px] gap-2">
                <div className="space-y-1">
                  <Label htmlFor={`pb-rl-${i}`} className="type-caption">Reward {i + 1}</Label>
                  <Input id={`pb-rl-${i}`} value={r.label} onChange={(e) => set({ rewards: draft.rewards.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)) })} />
                </div>
                <div className="space-y-1">
                  <Label htmlFor={`pb-ra-${i}`} className="type-caption">Credits</Label>
                  <Input id={`pb-ra-${i}`} type="number" min={1} value={r.amount} onChange={(e) => set({ rewards: draft.rewards.map((x, j) => (j === i ? { ...x, amount: Number(e.target.value) } : x)) })} />
                </div>
              </div>
            ))}
          </fieldset>
          <fieldset className="space-y-2">
            <legend className="type-body font-semibold">Tax display by billed region</legend>
            {Object.keys(draft.taxDisplay).map((r) => (
              <div key={r} className="flex items-center gap-2">
                <Switch id={`pb-tax-${r}`} checked={draft.taxDisplay[r]} onCheckedChange={(v) => set({ taxDisplay: { ...draft.taxDisplay, [r]: v } })} />
                <Label htmlFor={`pb-tax-${r}`} className="font-normal">Show tax on prices in {r.toUpperCase()}{regionIds.includes(r) ? "" : " (no region pack)"}</Label>
              </div>
            ))}
          </fieldset>
        </section>
        <div className="space-y-6">
          <section aria-labelledby="lint-h" className="space-y-2 rounded-xl border border-border bg-card p-4">
            <h3 id="lint-h" className="type-heading">Pack lint</h3>
            {!parsed.ok && (
              <ul role="alert" className="space-y-1 type-caption text-blocked-ink">
                {parsed.issues.slice(0, 4).map((i) => (
                  <li key={`${i.path}${i.message}`}>
                    {i.path}: {i.message}
                  </li>
                ))}
              </ul>
            )}
            {parsed.ok && lint.length === 0 && (
              <p className="flex items-center gap-2 type-body text-healthy-ink">
                <CheckCircle2 aria-hidden="true" className="size-4" />
                No risky configuration found.
              </p>
            )}
            <ul aria-live="polite" className="space-y-2">
              {lint.map((l) => (
                <li key={l.path + l.id} className={`flex gap-2 rounded-md p-2 type-caption ${l.level === "error" ? "bg-blocked-soft text-blocked-ink" : "bg-watch-soft text-watch-ink"}`}>
                  <AlertTriangle aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
                  <span>
                    <span className="font-semibold">{l.level === "error" ? "Error" : "Warning"}: </span>
                    {l.text}
                  </span>
                </li>
              ))}
            </ul>
            <Button className="w-full" disabled={!pack || errors.length > 0 || taken} onClick={() => setSheet(true)}>
              <Rocket aria-hidden="true" />
              Load as a new tenant
            </Button>
            {errors.length > 0 && <p className="type-caption text-muted-foreground">Fix the errors to load it. Warnings can be accepted at approval.</p>}
          </section>
          {pack && <HubPreview pack={pack} />}
        </div>
      </div>
      <LintAll />
      {pack && (
        <ApprovalSheet
          open={sheet}
          onOpenChange={setSheet}
          title={`Load ${pack.company}?`}
          description="The pack becomes a new tenant with seeded accounts. It does not change any other tenant."
          preview={<HubPreview pack={pack} />}
          diff={[{ path: "tenants", before: "", after: `${pack.company} (${pack.id})` }]}
          risk={{ level: lint.length ? "medium" : "low", reasons: lint.length ? lint.map((l) => l.text) : ["Lint is clean."] }}
          auditId={`pack-${pack.id}`}
          onApprove={load}
          onReject={() => setSheet(false)}
          approveLabel="Approve and load"
        />
      )}
    </div>
  );
}

/** How the Credits Hub looks with this pack: balance, plans, top-ups and rewards. */
function HubPreview({ pack }: { pack: TenantPack }) {
  const prim = pack.meters[0];
  const plan = pack.plans.find((p) => p.paid && !p.proposed && (p.included[prim.id] ?? 0) > 0) ?? pack.plans[0];
  const inc = plan.included[prim.id] ?? 0;
  const rule = pack.grantRules.find((g) => g.plan === plan.id && g.meter === prim.id) ?? pack.grantRules.find((g) => g.plan === "*" && g.meter === prim.id);
  return (
    <section aria-label="Credits Hub preview" className="space-y-3 rounded-xl border border-border bg-background p-4 shadow-sm">
      <div className="flex items-center gap-2">
        <span aria-hidden="true" className="flex size-6 items-center justify-center rounded text-xs text-white" style={{ background: pack.brand.accent.light }}>
          {pack.brand.glyph}
        </span>
        <span className="type-body font-semibold">{pack.brand.wordmark} · {pack.copy["hub.title"] ?? "Credits Hub"}</span>
        <ToneBadge tone="info" className="ml-auto">Preview</ToneBadge>
      </div>
      <div className="space-y-1">
        <div className="flex items-baseline justify-between">
          <span className="type-caption text-muted-foreground">{plan.name} · {prim.label}</span>
          <span className="num type-heading">{fmtNum(Math.round(inc * 0.62))}</span>
        </div>
        <MeterBar meter={prim} used={inc * 0.38} held={0} remaining={inc * 0.62} expiring={0} compact />
        <p className="type-caption text-muted-foreground">
          {fmtNum(inc)} a month{rule?.rollover.mode === "none" ? ", no rollover" : rule?.rollover.mode === "full" ? ", unused credits roll over" : `, rollover up to ${rule?.rollover.capX}×`}
          {rule?.expiryDays ? `, expire after ${rule.expiryDays} days` : ""}. {fmtUsd(prim.pricePerUnit, 3)} per {prim.unit.replace(/s$/, "")}.
        </p>
      </div>
      <div className="grid grid-cols-3 gap-2">
        {pack.topUpPacks.filter((p) => p.meter === prim.id && !p.proposed).slice(0, 3).map((p) => (
          <div key={p.id} className="rounded-md border border-border p-2 text-center">
            <div className="type-body font-semibold">{fmtNum(p.units)}</div>
            <div className="type-caption text-muted-foreground">{fmtUsd(p.price, 0)} · {fmtUsd(p.price / p.units, 3)} each</div>
          </div>
        ))}
      </div>
      <ul className="space-y-1 type-caption">
        {pack.rewards.map((r) => (
          <li key={r.id}>
            Reward: {r.label} · +{fmtNum(r.amount)}
          </li>
        ))}
      </ul>
      <p className="type-caption text-muted-foreground">
        {pack.ledgerPolicy.allowNegative ? `Balance may go to −${fmtNum(pack.ledgerPolicy.overdraft)}` : "Runs stop at zero and say why"} · rewards up to {fmtNum(rewardCapPerAccount(pack))} a month vs {fmtNum(breakagePerAccount(pack))} forecast breakage per account.
      </p>
    </section>
  );
}

function LintAll() {
  const list = useTenantList();
  const tenants = useCockpit((s) => s.data.tenants);
  const rows = list.map((x) => {
    const p = builtInPack(x.id) ?? tenants[x.id]?.pack;
    return { id: x.id, company: x.company, issues: p ? lintPack(p, regionIds) : [] };
  });
  return (
    <section aria-labelledby="la-h" className="space-y-3">
      <SectionTitle id="la-h" aside="The same rules on every loaded pack">
        Lint across tenants
      </SectionTitle>
      <Table>
        <TableCaption className="sr-only">Lint results for every tenant pack</TableCaption>
        <TableHeader>
          <TableRow>
            <TableHead scope="col">Tenant</TableHead>
            <TableHead scope="col">Archetype</TableHead>
            <TableHead scope="col">Findings</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => {
            const p = builtInPack(r.id) ?? tenants[r.id]?.pack;
            return (
              <TableRow key={r.id}>
                <TableHead scope="row">{r.company}</TableHead>
                <TableCell>{ARCHETYPES.find((a) => a.id === p?.archetype)?.label ?? "—"}</TableCell>
                <TableCell className="whitespace-normal type-caption">{r.issues.length ? r.issues.map((i) => i.text).join(" ") : "Clean"}</TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </section>
  );
}
