import { useState, type FormEvent, type ReactNode } from "react";
import { toast } from "sonner";
import { CheckCircle2, CircleAlert, Trash2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { SectionTitle } from "@/ui/primitives";
import { ToneBadge } from "@/ui/tone";
import { fmtUsd } from "@/core/format";
import { updatePack, type TenantState } from "@/core";
import { MOMENT_IDS, parsePack, type PackIssue, type TenantPack } from "@/tenants/schema";
import { PACK_LOAD } from "@/tenants/registry";
import { personaById } from "@/tenants/personas";
import { packRisk } from "@/agents/onboarding";
import { useCockpit, useTenantList } from "@/lib/cockpit-store";
import { useConfirm } from "@/hooks/use-confirm";

type Run = (fn: (s: TenantState) => TenantState, ok: string) => void;

const MOMENT_LABEL: Record<(typeof MOMENT_IDS)[number], string> = {
  "ran-out": "Ran out",
  "run-out-forecast": "Runs out soon (forecast)",
  "payment-failed": "Payment failed",
  "plan-fit": "Better plan available",
  "reward-available": "Reward available",
  "expiring-soon": "Credits expiring soon",
  "approval-needed": "Approval needed",
  "run-blocked": "Run blocked (typed reason)",
  threshold: "Usage thresholds (80/90/100%)",
  "mid-run": "Paused mid-run",
  "auto-cap": "Auto top-up reached its cap",
  "card-expiring": "Card expiring (30 days out)",
  "soft-landing": "Payment failed, soft landing",
  "request-credits": "Credit requests waiting",
  spark: "Daily Spark",
};

const n = (v: FormDataEntryValue | null, d = 0) => {
  const x = Number(v);
  return v === null || v === "" || !Number.isFinite(x) ? d : x;
};
const optional = (v: FormDataEntryValue | null) => (v === null || String(v).trim() === "" ? null : Math.max(0, Number(v)) || null);

export function PackTab({ t, run }: { t: TenantState; run: Run }) {
  const pack = t.pack;
  const key = JSON.stringify(pack).length + pack.id;

  /** Every edit is re-validated against the schema before it is saved. */
  const save = (mutate: (p: TenantPack) => void, note: string, ok: string) => {
    const draft = structuredClone(pack);
    mutate(draft);
    const r = parsePack(draft);
    if (!r.ok) {
      toast.error(`Not saved: ${r.issues[0].path} ${r.issues[0].message}`);
      return;
    }
    run((s) => updatePack(s, mutate, note), ok);
  };

  return (
    <div className="grid gap-6 xl:grid-cols-[340px_minmax(0,1fr)]">
      <div className="min-w-0 space-y-6">
        <PackSources />
        <LoadJson />
      </div>
      <div key={key} className="min-w-0 space-y-6">
        <p className="type-caption text-muted-foreground">
          Edits are checked against the schema and apply from the next grant, top-up or run. To replay the current cycle with them, use Re-seed in the Simulator.
        </p>
        <MetersEditor pack={pack} save={save} />
        <PlansEditor pack={pack} save={save} />
        <GrantsEditor pack={pack} save={save} />
        <PacksEditor pack={pack} save={save} />
        <LimitsEditor pack={pack} save={save} />
        <MomentsEditor pack={pack} save={save} />
        <ReadOnly pack={pack} />
      </div>
    </div>
  );
}

type Save = (mutate: (p: TenantPack) => void, note: string, ok: string) => void;

function Panel({ id, title, aside, children }: { id: string; title: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="space-y-3 rounded-xl border border-border bg-card p-4">
      <SectionTitle id={id} as="h3" aside={aside}>
        {title}
      </SectionTitle>
      {children}
    </section>
  );
}

const ORDER = ["clay", "builderco", "apico"];
const order = (id: string | undefined) => (id && ORDER.includes(id) ? ORDER.indexOf(id) : ORDER.length);

function PackSources() {
  const list = useTenantList();
  const active = useCockpit((s) => s.data.activeTenant);
  const setTenant = useCockpit((s) => s.setTenant);
  const removeTenant = useCockpit((s) => s.removeTenant);
  const confirm = useConfirm();
  const custom = list.filter((x) => x.custom);
  return (
    <Panel id="sources-title" title="Packs" aside={`${PACK_LOAD.length} files · ${custom.length} loaded`}>
      <ul className="space-y-2">
        {[...PACK_LOAD].sort((a, b) => order(a.pack?.id) - order(b.pack?.id)).map((l) => (
          <li key={l.file} className="flex items-start gap-3 rounded-lg border border-border p-3">
            {l.pack ? <CheckCircle2 aria-hidden="true" className="mt-0.5 size-4 text-healthy" /> : <CircleAlert aria-hidden="true" className="mt-0.5 size-4 text-blocked" />}
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2 type-body font-medium">
                {l.pack?.company ?? l.file}
                {l.pack?.id === active && <ToneBadge tone="info">Active</ToneBadge>}
              </div>
              <div className="font-mono type-caption break-all text-muted-foreground">tenants/{l.file}</div>
              {l.pack ? (
                <div className="type-caption text-muted-foreground">
                  Schema valid · {l.pack.meters.length} meter{l.pack.meters.length === 1 ? "" : "s"} · {l.pack.billingModel}
                </div>
              ) : (
                <ul className="mt-1 type-caption text-blocked-ink">
                  {l.issues.slice(0, 4).map((i) => (
                    <li key={i.path + i.message}>
                      {i.path}: {i.message}
                    </li>
                  ))}
                </ul>
              )}
            </div>
            {l.pack && l.pack.id !== active && (
              <Button size="xs" variant="outline" onClick={() => setTenant(l.pack!.id)}>
                Open
              </Button>
            )}
          </li>
        ))}
        {custom.map((c) => (
          <li key={c.id} className="flex items-start gap-3 rounded-lg border border-border p-3">
            <CheckCircle2 aria-hidden="true" className="mt-0.5 size-4 text-healthy" />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2 type-body font-medium">
                {c.company}
                <ToneBadge tone="reward">Loaded</ToneBadge>
                {c.id === active && <ToneBadge tone="info">Active</ToneBadge>}
              </div>
              <div className="type-caption text-muted-foreground">Approved at runtime · stored in this browser</div>
            </div>
            <div className="flex gap-1">
              {c.id !== active && (
                <Button size="xs" variant="outline" onClick={() => setTenant(c.id)}>
                  Open
                </Button>
              )}
              <Button
                size="xs"
                variant="ghost"
                aria-label={`Remove ${c.company}`}
                onClick={async () => {
                  if (await confirm({ title: `Remove ${c.company}?`, description: "Its ledger, events and approvals are deleted from this browser.", confirmLabel: "Remove", destructive: true })) {
                    removeTenant(c.id);
                    toast.success(`${c.company} removed.`);
                  }
                }}
              >
                <Trash2 aria-hidden="true" />
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

function LoadJson() {
  const addTenant = useCockpit((s) => s.addTenant);
  const list = useTenantList();
  const actor = personaById(useCockpit((s) => s.persona)).name;
  const [text, setText] = useState("");
  const [result, setResult] = useState<{ pack: TenantPack | null; issues: PackIssue[] } | null>(null);

  const check = () => {
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      setResult({ pack: null, issues: [{ path: "(root)", message: "Not valid JSON" }] });
      return;
    }
    const r = parsePack(json);
    if (r.ok && list.some((x) => x.id === r.pack.id)) {
      setResult({ pack: null, issues: [{ path: "id", message: `"${r.pack.id}" is already a tenant. Change the id.` }] });
      return;
    }
    setResult(r.ok ? { pack: r.pack, issues: [] } : { pack: null, issues: r.issues });
  };

  const onFile = async (f: File | undefined) => {
    if (!f) return;
    if (f.size > 200_000) {
      toast.error("That file is over 200 KB.");
      return;
    }
    setText(await f.text());
    setResult(null);
  };

  const load = () => {
    const p = result?.pack;
    if (!p) return;
    const risk = packRisk(p, null);
    const a = addTenant(p, { title: `Load ${p.company} Tenant Pack`, actor, decision: "approved", risk: risk.level, summary: "Loaded from JSON in the Brain" });
    toast.success(`${p.company} loaded${a ? ` · ${a.id}` : ""}.`);
    setText("");
    setResult(null);
  };

  return (
    <Panel id="load-title" title="Load a pack from JSON">
      <div className="space-y-1.5">
        <Label htmlFor="pack-file">JSON file</Label>
        <Input id="pack-file" type="file" accept="application/json,.json" onChange={(e) => void onFile(e.target.files?.[0])} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="pack-json">Or paste it</Label>
        <Textarea id="pack-json" rows={6} value={text} onChange={(e) => (setText(e.target.value), setResult(null))} className="font-mono text-xs" spellCheck={false} />
      </div>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" disabled={!text.trim()} onClick={check}>
          Validate
        </Button>
        <Button size="sm" disabled={!result?.pack} onClick={load}>
          <Upload aria-hidden="true" />
          Load as tenant
        </Button>
      </div>
      {result && (
        <div role="status" className={result.pack ? "type-caption text-healthy-ink" : "type-caption text-blocked-ink"}>
          {result.pack ? (
            `Valid: ${result.pack.company}, ${result.pack.meters.length} meters, ${result.pack.plans.length} plans.`
          ) : (
            <ul className="list-disc pl-4">
              {result.issues.slice(0, 8).map((i) => (
                <li key={i.path + i.message}>
                  <span className="font-mono">{i.path}</span>: {i.message}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </Panel>
  );
}

function SaveRow({ label = "Save" }: { label?: string }) {
  return (
    <Button type="submit" size="sm">
      {label}
    </Button>
  );
}

function MetersEditor({ pack, save }: { pack: TenantPack; save: Save }) {
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    save(
      (p) =>
        p.meters.forEach((m) => {
          m.label = String(f.get(`label-${m.id}`) ?? m.label).trim() || m.label;
          m.pricePerUnit = Math.max(0, n(f.get(`price-${m.id}`), m.pricePerUnit));
        }),
      "Meters edited",
      "Meters saved.",
    );
  };
  return (
    <Panel id="meters-title" title="Meters" aside={pack.expansion === "independent" ? "Each meter expands on its own" : "Expands with the plan"}>
      <form onSubmit={submit} className="space-y-3">
        <Table>
          <TableCaption className="sr-only">Meters</TableCaption>
          <TableHeader>
            <TableRow>
              <TableHead scope="col">Meter</TableHead>
              <TableHead scope="col">Label</TableHead>
              <TableHead scope="col">Type</TableHead>
              <TableHead scope="col">List price (USD)</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {pack.meters.map((m) => (
              <TableRow key={m.id}>
                <TableHead scope="row" className="font-mono type-caption font-normal">{m.id}</TableHead>
                <TableCell>
                  <Input aria-label={`${m.id} label`} name={`label-${m.id}`} defaultValue={m.label} className="h-8 min-w-32" />
                </TableCell>
                <TableCell className="type-caption">{m.valueType}</TableCell>
                <TableCell>
                  <Input aria-label={`${m.label} list price`} name={`price-${m.id}`} type="number" min={0} step="any" defaultValue={m.pricePerUnit} className="h-8 w-28" />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {pack.byokDiscount && (
          <p className="type-caption text-muted-foreground">
            Own-key discount: {pack.byokDiscount.pct}% off {pack.meters.find((m) => m.id === pack.byokDiscount?.meter)?.label} on steps that run on the customer's own API key.
          </p>
        )}
        <SaveRow label="Save meters" />
      </form>
    </Panel>
  );
}

function PlansEditor({ pack, save }: { pack: TenantPack; save: Save }) {
  const prepaid = pack.billingModel === "prepaid";
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    save(
      (p) =>
        p.plans.forEach((pl) => {
          if (pl.price != null) pl.price = Math.max(0, n(f.get(`price-${pl.id}`), pl.price));
          for (const m of p.meters) pl.included[m.id] = Math.max(0, n(f.get(`inc-${pl.id}-${m.id}`), pl.included[m.id] ?? 0));
          if (prepaid && pl.caps.monthlySpend != null) pl.caps.monthlySpend = Math.max(0, n(f.get(`cap-${pl.id}`), pl.caps.monthlySpend));
        }),
      "Plans edited",
      "Plans saved.",
    );
  };
  return (
    <Panel id="plans-title" title="Plans" aside="Included amounts are per grant (see Grant rules)">
      <form onSubmit={submit} className="space-y-3">
        <Table>
          <TableCaption className="sr-only">Plans with price, included amounts and caps</TableCaption>
          <TableHeader>
            <TableRow>
              <TableHead scope="col">Plan</TableHead>
              <TableHead scope="col">Price / mo</TableHead>
              {pack.meters.map((m) => (
                <TableHead key={m.id} scope="col">
                  {m.label} included
                </TableHead>
              ))}
              {prepaid && <TableHead scope="col">Spend cap / mo</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {pack.plans.map((pl) => (
              <TableRow key={pl.id}>
                <TableHead scope="row">
                  <span className="flex flex-wrap items-center gap-1.5">
                    {pl.name}
                    {pl.proposed && <ToneBadge tone="info">Proposed</ToneBadge>}
                    {!pl.paid && <ToneBadge tone="neutral">Free</ToneBadge>}
                  </span>
                </TableHead>
                <TableCell>
                  {pl.price == null ? (
                    <span className="type-caption text-muted-foreground">Custom</span>
                  ) : (
                    <Input aria-label={`${pl.name} price`} name={`price-${pl.id}`} type="number" min={0} step="any" defaultValue={pl.price} className="h-8 w-24" />
                  )}
                </TableCell>
                {pack.meters.map((m) => (
                  <TableCell key={m.id}>
                    <Input aria-label={`${pl.name} ${m.label} included`} name={`inc-${pl.id}-${m.id}`} type="number" min={0} step="any" defaultValue={pl.included[m.id] ?? 0} className="h-8 w-28" />
                  </TableCell>
                ))}
                {prepaid && (
                  <TableCell>
                    {pl.caps.monthlySpend == null ? (
                      <span className="type-caption text-muted-foreground">None</span>
                    ) : (
                      <Input aria-label={`${pl.name} spend cap`} name={`cap-${pl.id}`} type="number" min={0} defaultValue={pl.caps.monthlySpend} className="h-8 w-28" />
                    )}
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <SaveRow label="Save plans" />
      </form>
    </Panel>
  );
}

function GrantsEditor({ pack, save }: { pack: TenantPack; save: Save }) {
  const planName = (id: string) => (id === "*" ? "Every other plan" : (pack.plans.find((p) => p.id === id)?.name ?? id));
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    save(
      (p) =>
        p.grantRules.forEach((g, i) => {
          g.cadence = f.get(`cad-${i}`) === "daily" ? "daily" : "monthly";
          g.monthlyCap = g.cadence === "daily" ? optional(f.get(`mcap-${i}`)) : null;
          const mode = String(f.get(`roll-${i}`));
          g.rollover = { mode: mode === "full" || mode === "capped" ? mode : "none", capX: Math.max(0, n(f.get(`capx-${i}`), g.rollover.capX)) };
          g.expiryDays = optional(f.get(`exp-${i}`));
          if (g.expiryDays != null) g.expiryDays = Math.round(g.expiryDays);
        }),
      "Grant rules edited",
      "Grant rules saved.",
    );
  };
  return (
    <Panel id="grants-title" title="Grant rules" aside="Cadence, rollover and expiry per plan and meter">
      <form onSubmit={submit} className="space-y-3">
        <Table>
          <TableCaption className="sr-only">Grant rules</TableCaption>
          <TableHeader>
            <TableRow>
              <TableHead scope="col">Plan · meter</TableHead>
              <TableHead scope="col">Cadence</TableHead>
              <TableHead scope="col">Monthly cap</TableHead>
              <TableHead scope="col">Rollover</TableHead>
              <TableHead scope="col">Cap ×</TableHead>
              <TableHead scope="col">Expires (days)</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {pack.grantRules.map((g, i) => {
              const label = `${planName(g.plan)} ${pack.meters.find((m) => m.id === g.meter)?.label ?? g.meter}`;
              return (
                <TableRow key={`${g.plan}-${g.meter}-${i}`}>
                  <TableHead scope="row" className="font-normal">
                    {planName(g.plan)} · {pack.meters.find((m) => m.id === g.meter)?.label ?? g.meter}
                  </TableHead>
                  <TableCell>
                    <NativeSelect size="sm" aria-label={`${label} cadence`} name={`cad-${i}`} defaultValue={g.cadence}>
                      <NativeSelectOption value="monthly">Monthly</NativeSelectOption>
                      <NativeSelectOption value="daily">Daily</NativeSelectOption>
                    </NativeSelect>
                  </TableCell>
                  <TableCell>
                    <Input aria-label={`${label} monthly cap for daily grants`} name={`mcap-${i}`} type="number" min={0} defaultValue={g.monthlyCap ?? ""} placeholder="None" className="h-8 w-20" />
                  </TableCell>
                  <TableCell>
                    <NativeSelect size="sm" aria-label={`${label} rollover`} name={`roll-${i}`} defaultValue={g.rollover.mode}>
                      <NativeSelectOption value="none">None</NativeSelectOption>
                      <NativeSelectOption value="capped">Capped</NativeSelectOption>
                      <NativeSelectOption value="full">Full</NativeSelectOption>
                    </NativeSelect>
                  </TableCell>
                  <TableCell>
                    <Input aria-label={`${label} rollover cap, times the grant`} name={`capx-${i}`} type="number" min={0} step={0.5} defaultValue={g.rollover.capX} className="h-8 w-16" />
                  </TableCell>
                  <TableCell>
                    <Input aria-label={`${label} expiry in days`} name={`exp-${i}`} type="number" min={1} defaultValue={g.expiryDays ?? ""} placeholder="Never" className="h-8 w-20" />
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
        <SaveRow label="Save grant rules" />
      </form>
    </Panel>
  );
}

function PacksEditor({ pack, save }: { pack: TenantPack; save: Save }) {
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    save(
      (p) =>
        p.topUpPacks.forEach((t) => {
          t.units = Math.max(0.01, n(f.get(`u-${t.id}`), t.units));
          t.price = Math.max(0, n(f.get(`p-${t.id}`), t.price));
          const v = optional(f.get(`v-${t.id}`));
          t.validityDays = v == null ? null : Math.round(v);
        }),
      "Top-up packs edited",
      "Top-up packs saved.",
    );
  };
  return (
    <Panel id="packs-title" title="Top-up packs" aside={`${pack.topUpPacks.length} packs`}>
      {pack.topUpPacks.length ? (
        <form onSubmit={submit} className="space-y-3">
          <Table>
            <TableCaption className="sr-only">Top-up packs</TableCaption>
            <TableHeader>
              <TableRow>
                <TableHead scope="col">Pack</TableHead>
                <TableHead scope="col">Units</TableHead>
                <TableHead scope="col">Price (USD)</TableHead>
                <TableHead scope="col">Valid (days)</TableHead>
                <TableHead scope="col">Per unit</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pack.topUpPacks.map((t) => {
                const m = pack.meters.find((x) => x.id === t.meter);
                return (
                  <TableRow key={t.id}>
                    <TableHead scope="row" className="font-normal">
                      <span className="flex flex-wrap items-center gap-1.5">
                        {m?.label ?? t.meter}
                        {t.proposed && <ToneBadge tone="info">Proposed</ToneBadge>}
                      </span>
                    </TableHead>
                    <TableCell>
                      <Input aria-label={`${t.id} units`} name={`u-${t.id}`} type="number" min={0.01} step="any" defaultValue={t.units} className="h-8 w-24" />
                    </TableCell>
                    <TableCell>
                      <Input aria-label={`${t.id} price`} name={`p-${t.id}`} type="number" min={0} step="any" defaultValue={t.price} className="h-8 w-24" />
                    </TableCell>
                    <TableCell>
                      <Input aria-label={`${t.id} validity in days`} name={`v-${t.id}`} type="number" min={1} defaultValue={t.validityDays ?? ""} placeholder="Never" className="h-8 w-20" />
                    </TableCell>
                    <TableCell className="type-caption num">{fmtUsd(t.price / t.units, t.price / t.units < 0.1 ? 4 : 2)}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
          <SaveRow label="Save packs" />
        </form>
      ) : (
        <p className="type-body text-muted-foreground">This pack sells no top-ups.</p>
      )}
    </Panel>
  );
}

function LimitsEditor({ pack, save }: { pack: TenantPack; save: Save }) {
  const prim = pack.meters[0];
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    save(
      (p) => {
        p.autoTopUp.threshold = Math.max(0, n(f.get("at-threshold"), p.autoTopUp.threshold));
        p.autoTopUp.amount = Math.max(0.01, n(f.get("at-amount"), p.autoTopUp.amount));
        p.autoTopUp.monthlySpendLimit = Math.max(0, n(f.get("at-limit"), p.autoTopUp.monthlySpendLimit));
        p.limits.spend.selfSetCap = f.get("self-cap") === "on";
        p.limits.spend.tierCaps = f.get("tier-caps") === "on";
        p.limits.rate.runsPerMinute = Math.max(1, Math.round(n(f.get("rpm"), p.limits.rate.runsPerMinute)));
        p.limits.rate.agentRunsPerHour = Math.max(1, Math.round(n(f.get("arph"), p.limits.rate.agentRunsPerHour)));
        p.ledgerPolicy = { allowNegative: f.get("allow-negative") === "on", overdraft: Math.max(0, n(f.get("overdraft"), p.ledgerPolicy.overdraft)) };
      },
      "Limits and auto top-up defaults edited",
      "Limits saved.",
    );
  };
  return (
    <Panel id="limits-title" title="Auto top-up defaults and limits">
      <form onSubmit={submit} className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <Field id="at-threshold" label={`Top up below (${prim.valueType === "currency" ? "USD" : prim.label})`} value={pack.autoTopUp.threshold} />
          <Field id="at-amount" label={`Add (${prim.valueType === "currency" ? "USD" : prim.label})`} value={pack.autoTopUp.amount} />
          <Field id="at-limit" label="Monthly limit (USD)" value={pack.autoTopUp.monthlySpendLimit} />
          <Field id="rpm" label="Runs per minute" value={pack.limits.rate.runsPerMinute} />
          <Field id="arph" label="Agent runs per hour" value={pack.limits.rate.agentRunsPerHour} />
          <Field id="overdraft" label={`Overdraft when allowed (${prim.valueType === "currency" ? "USD" : prim.label})`} value={pack.ledgerPolicy.overdraft} />
        </div>
        <div className="flex flex-wrap gap-6">
          <div className="flex items-center gap-2">
            <Switch id="self-cap" name="self-cap" defaultChecked={pack.limits.spend.selfSetCap} />
            <Label htmlFor="self-cap">Customers set their own spend cap</Label>
          </div>
          <div className="flex items-center gap-2">
            <Switch id="tier-caps" name="tier-caps" defaultChecked={pack.limits.spend.tierCaps} />
            <Label htmlFor="tier-caps">Plans carry tier spend caps</Label>
          </div>
          <div className="flex items-center gap-2">
            <Switch id="allow-negative" name="allow-negative" defaultChecked={pack.ledgerPolicy.allowNegative} />
            <Label htmlFor="allow-negative">Balances may go below zero (up to the overdraft)</Label>
          </div>
        </div>
        <p className="type-caption text-muted-foreground">Off by default: a run that would take a balance below zero is blocked with a typed reason the Credits Hub explains.</p>
        <SaveRow label="Save limits" />
      </form>
    </Panel>
  );
}

function Field({ id, label, value }: { id: string; label: string; value: number }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} name={id} type="number" min={0} step="any" defaultValue={value} className="h-8" />
    </div>
  );
}

function MomentsEditor({ pack, save }: { pack: TenantPack; save: Save }) {
  const toggle = (id: (typeof MOMENT_IDS)[number], on: boolean) =>
    save(
      (p) => {
        p.moments = on ? [...new Set([...p.moments, id])] : p.moments.filter((x) => x !== id);
      },
      `Moment ${id} ${on ? "on" : "off"}`,
      `${MOMENT_LABEL[id]} ${on ? "on" : "off"}.`,
    );
  return (
    <Panel id="moments-title" title="Designed moments" aside={`${pack.moments.length} of ${MOMENT_IDS.length} on`}>
      <ul className="grid gap-2 sm:grid-cols-2">
        {MOMENT_IDS.map((id) => (
          <li key={id} className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2">
            <Label htmlFor={`mo-${id}`} className="font-normal">
              {MOMENT_LABEL[id]}
            </Label>
            <Switch id={`mo-${id}`} checked={pack.moments.includes(id)} onCheckedChange={(v) => toggle(id, v)} />
          </li>
        ))}
      </ul>
    </Panel>
  );
}

function ReadOnly({ pack }: { pack: TenantPack }) {
  return (
    <Panel id="ro-title" title="Models, regions, compliance and copy" aside="Read-only here; edit the pack JSON">
      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <h4 className="type-caption font-semibold text-muted-foreground">Model catalog</h4>
          <ul className="mt-1 space-y-1 type-body">
            {pack.models.map((m) => (
              <li key={m.id} className="flex justify-between gap-3">
                <span>
                  {m.name} <span className="type-caption text-muted-foreground">· {m.provider}</span>
                  {m.default && <ToneBadge tone="info" className="ml-1.5">Default</ToneBadge>}
                </span>
                <span className="num type-caption">{fmtUsd(m.providerCostPerRun, 3)}/run</span>
              </li>
            ))}
            {!pack.models.length && <li className="text-muted-foreground">None</li>}
          </ul>
        </div>
        <div>
          <h4 className="type-caption font-semibold text-muted-foreground">Regions</h4>
          <ul className="mt-1 space-y-1 type-body">
            {pack.regions.map((r) => (
              <li key={r.id}>
                {r.name} <span className="type-caption text-muted-foreground">· {r.residency}</span>
              </li>
            ))}
            {!pack.regions.length && <li className="text-muted-foreground">None</li>}
          </ul>
          <h4 className="mt-3 type-caption font-semibold text-muted-foreground">Compliance</h4>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {Object.entries(pack.compliance).map(([k, v]) => (
              <ToneBadge key={k} tone={v ? "healthy" : "neutral"}>
                {k} {v ? "yes" : "no"}
              </ToneBadge>
            ))}
          </div>
        </div>
        <div className="md:col-span-2">
          <h4 className="type-caption font-semibold text-muted-foreground">Rewards</h4>
          <ul className="mt-1 space-y-1 type-body">
            {pack.rewards.map((r) => (
              <li key={r.id}>
                +{r.amount} {pack.meters.find((m) => m.id === r.meter)?.label} · {r.label}
                <span className="type-caption text-muted-foreground"> · {r.expiryDays ? `expires after ${r.expiryDays} days` : "no expiry"}</span>
              </li>
            ))}
            {!pack.rewards.length && <li className="text-muted-foreground">None</li>}
          </ul>
        </div>
        <div className="md:col-span-2">
          <h4 className="type-caption font-semibold text-muted-foreground">Copy overrides</h4>
          <dl className="mt-1 grid gap-x-4 gap-y-1 type-body sm:grid-cols-[200px_minmax(0,1fr)]">
            {Object.entries(pack.copy).map(([k, v]) => (
              <div key={k} className="contents">
                <dt className="font-mono type-caption text-muted-foreground">{k}</dt>
                <dd>{v}</dd>
              </div>
            ))}
          </dl>
          {!Object.keys(pack.copy).length && <p className="type-body text-muted-foreground">None</p>}
        </div>
      </div>
      <Collapsible>
        <CollapsibleTrigger asChild>
          <Button size="sm" variant="outline">
            View pack JSON
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <pre className="mt-3 max-h-96 overflow-auto rounded-lg bg-muted p-3 font-mono text-xs">{JSON.stringify(pack, null, 2)}</pre>
        </CollapsibleContent>
      </Collapsible>
    </Panel>
  );
}
