import { useMemo, useState, type FormEvent, type ReactNode } from "react";
import { toast } from "sonner";
import { ArrowRight, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { LiveStatus } from "@/components/live-status";
import { useNavigate } from "react-router-dom";
import { InsightList, SectionTitle } from "@/ui/primitives";
import { ToneBadge } from "@/ui/tone";
import { LedgerTable } from "@/ui/ledger-table";
import { amountText, fmtDate, fmtDateTime, fmtNum } from "@/core/format";
import { eventLabel } from "@/surfaces/credits-hub/labels";
import { PackTab } from "@/surfaces/brain/pack-editor";
import { ApprovalsTab, SimTab } from "@/surfaces/brain/sim";
import { ChatsTab, PopulationTab } from "@/surfaces/brain/population";
import { RegionsTab } from "@/surfaces/brain/regions";
import { DomainTab } from "@/surfaces/brain/domain";
import { ChecksTab } from "@/surfaces/brain/checks";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useConfirm } from "@/hooks/use-confirm";
import { SOURCE_LABEL } from "@/ui/ledger-table";
import { useCockpit, useTenant, type BrainTab } from "@/lib/cockpit-store";
import { SPEND_TIER, cycleOf, grantPromo, hubInsights, isReversed, lotsOf, meterOf, reverseLedgerEntry, verifyChain, workbenchInsights, type LedgerEntry, type TenantState } from "@/core";
import { HUB_PERSONAS, personaRole } from "@/tenants/personas";
import { cn } from "@/lib/utils";

const PAGE = 40;

const TABS: { id: BrainTab; label: string }[] = [
  { id: "pack", label: "Tenant Pack" },
  { id: "regions", label: "Regions" },
  { id: "domain", label: "Domain model" },
  { id: "ledger", label: "Credit ledger" },
  { id: "events", label: "Usage events" },
  { id: "population", label: "Population" },
  { id: "chats", label: "Help chats" },
  { id: "insights", label: "Insights" },
  { id: "sim", label: "Clock" },
  { id: "approvals", label: "Approvals" },
  { id: "checks", label: "Checks" },
];

export function BrainPage() {
  const t = useTenant();
  const tab = useCockpit((s) => s.brainTab);
  const setUi = useCockpit((s) => s.setUi);
  const setPersona = useCockpit((s) => s.setPersona);
  const apply = useCockpit((s) => s.apply);
  const navigate = useNavigate();
  const [said, setSaid] = useState({ n: 0, text: "" });
  const pack = t.pack;
  const chain = useMemo(() => verifyChain(t.ledger), [t.ledger]);
  const hubCount = HUB_PERSONAS.reduce((s, id) => s + hubInsights(t, id).length, 0);
  const wbCount = workbenchInsights(t).length;
  const lastEvent = t.events[t.events.length - 1];
  const { day } = cycleOf(t);

  const run = (fn: (s: TenantState) => TenantState, ok: string) => {
    const saved = apply(fn);
    const text = saved ? ok : `${ok} Not saved in this browser.`;
    setSaid((s) => ({ n: s.n + 1, text }));
    if (saved) toast.success(text);
    else toast.error(text);
  };
  const announce = (text: string) => setSaid((s) => ({ n: s.n + 1, text }));

  return (
    <div className="mx-auto max-w-[1440px] space-y-6 px-4 py-5 sm:px-6 sm:py-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="type-title">Brain · {pack.company}</h1>
          <p className="type-body text-muted-foreground">
            One Tenant Pack, one ledger and one event stream feed both surfaces. Day {day + 1} of the cycle.
          </p>
        </div>
        {t.custom && <ToneBadge tone="reward">Loaded at runtime</ToneBadge>}
      </div>

      <figure aria-labelledby="flow-caption" className="rounded-xl border border-border bg-card p-4 sm:p-5">
        <div className="grid items-stretch gap-3 lg:grid-cols-[1fr_auto_1fr_auto_1fr_auto_1fr]">
          <Node active={tab === "pack"} onClick={() => setUi({ brainTab: "pack" })} kicker="Config" title="Tenant Pack">
            {pack.meters.length} meter{pack.meters.length === 1 ? "" : "s"} · {pack.plans.length} plans · {pack.grantRules.length} grant rules · {pack.topUpPacks.length} packs
          </Node>
          <Arrow />
          <div className="grid gap-3">
            <Node active={tab === "events"} onClick={() => setUi({ brainTab: "events" })} kicker="Stream" title="Usage events">
              {fmtNum(t.events.length)} events{lastEvent ? ` · last ${fmtDateTime(lastEvent.ts)}` : ""}
            </Node>
            <Node active={tab === "ledger"} onClick={() => setUi({ brainTab: "ledger" })} kicker="Append-only" title="Credit ledger">
              <span className="inline-flex flex-wrap items-center gap-1.5">
                {fmtNum(t.ledger.length)} entries ·
                {chain.ok ? <ToneBadge tone="healthy">Chain verified</ToneBadge> : <ToneBadge tone="blocked">Broken at {chain.brokenAt}</ToneBadge>}
              </span>
            </Node>
          </div>
          <Arrow />
          <Node active={tab === "insights"} onClick={() => setUi({ brainTab: "insights" })} kicker="Derived" title="Insights">
            {hubCount} for customers · {wbCount} for {pack.company}
          </Node>
          <Arrow />
          <div className="grid gap-3">
            <Node
              onClick={() => {
                setPersona("maya");
                navigate("/");
              }}
              kicker="End-user surface"
              title="Credits Hub"
            >
              Maya, Dev
            </Node>
            <Node
              onClick={() => {
                setPersona("nia");
                navigate("/");
              }}
              kicker="Merchant surface"
              title="Growth Workbench"
            >
              Nia, Sam
            </Node>
          </div>
        </div>
        <figcaption id="flow-caption" className="mt-4 flex items-center gap-2 border-t border-dashed border-border pt-3 type-caption text-muted-foreground">
          <ArrowRight aria-hidden="true" className="size-3.5 shrink-0 rotate-180" />
          Both surfaces write back: runs, top-ups, rewards, limits, save plays, approvals and pack edits land as events, and value movements as ledger entries.
        </figcaption>
      </figure>

      <Tabs value={tab} onValueChange={(v) => setUi({ brainTab: v as BrainTab })}>
        <TabsList variant="line" aria-label="Brain sections" className="w-full flex-nowrap overflow-x-auto">
          {TABS.map((x) => (
            <TabsTrigger key={x.id} value={x.id}>
              {x.label}
              {x.id === "approvals" && t.approvals.length > 0 ? ` (${t.approvals.length})` : ""}
            </TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value="pack" className="pt-4">
          <PackTab t={t} run={run} />
        </TabsContent>
        <TabsContent value="regions" className="pt-4">
          <RegionsTab t={t} />
        </TabsContent>
        <TabsContent value="domain" className="pt-4">
          {tab === "domain" && <DomainTab t={t} />}
        </TabsContent>
        <TabsContent value="ledger" className="pt-4">
          <LedgerTab t={t} announce={announce} run={run} />
        </TabsContent>
        <TabsContent value="population" className="pt-4">
          {tab === "population" && <PopulationTab t={t} run={run} />}
        </TabsContent>
        <TabsContent value="chats" className="pt-4">
          {tab === "chats" && <ChatsTab t={t} />}
        </TabsContent>
        <TabsContent value="checks" className="pt-4">
          {tab === "checks" && <ChecksTab t={t} />}
        </TabsContent>
        <TabsContent value="events" className="pt-4">
          <EventsTab t={t} />
        </TabsContent>
        <TabsContent value="insights" className="pt-4">
          <div className="grid gap-6 lg:grid-cols-2">
            <section aria-labelledby="ins-hub" className="space-y-4">
              <SectionTitle id="ins-hub" aside="Read by the Credits Hub">
                Customer insights
              </SectionTitle>
              {HUB_PERSONAS.map((id) => (
                <div key={id} className="space-y-2 rounded-xl border border-border bg-card p-4">
                  <h3 className="type-body font-semibold">
                    {id === "dev" ? "Dev" : "Maya"} · {personaRole(pack, id)}
                  </h3>
                  <InsightList items={hubInsights(t, id)} empty="Nothing needs attention." />
                </div>
              ))}
            </section>
            <section aria-labelledby="ins-wb" className="space-y-4">
              <SectionTitle id="ins-wb" aside="Read by the Growth Workbench">
                {pack.company} insights
              </SectionTitle>
              <div className="rounded-xl border border-border bg-card p-4">
                <InsightList items={workbenchInsights(t)} empty="No insights yet." />
              </div>
            </section>
          </div>
        </TabsContent>
        <TabsContent value="sim" className="pt-4">
          <SimTab t={t} run={run} />
        </TabsContent>
        <TabsContent value="approvals" className="pt-4">
          <ApprovalsTab t={t} />
        </TabsContent>
      </Tabs>
      <LiveStatus>{said.n > 0 ? `${said.text} (${said.n})` : ""}</LiveStatus>
    </div>
  );
}

function Node({ kicker, title, children, onClick, active }: { kicker: string; title: string; children: ReactNode; onClick: () => void; active?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "flex h-full flex-col items-start gap-1 rounded-lg border p-3 text-left transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
        active ? "border-primary bg-background shadow-sm" : "border-border bg-background hover:bg-muted",
      )}
    >
      <span className="type-caption font-medium uppercase tracking-wide text-muted-foreground">{kicker}</span>
      <span className="type-body font-semibold">{title}</span>
      <span className="type-caption text-muted-foreground">{children}</span>
    </button>
  );
}

function Arrow() {
  return (
    <div aria-hidden="true" className="flex items-center justify-center text-muted-foreground">
      <ArrowRight className="size-5 rotate-90 lg:rotate-0" />
    </div>
  );
}

function LedgerTab({ t, announce, run }: { t: TenantState; announce: (text: string) => void; run: (fn: (s: TenantState) => TenantState, ok: string) => void }) {
  const pack = t.pack;
  const persona = useCockpit((s) => s.persona);
  const confirm = useConfirm();
  const actor = `merchant:${persona === "sam" ? "sam" : "nia"}`;
  const [account, setAccount] = useState("all");
  const [checked, setChecked] = useState<{ ok: boolean; at: number | null; n: number } | null>(null);
  const entries = t.ledger.filter((e) => account === "all" || e.account === account);
  const reversed = useMemo(() => new Set(t.ledger.filter((e) => e.kind === "reversal" && e.reverses).map((e) => e.reverses!)), [t.ledger]);
  const name = (id: string) => (id === "maya" ? "Maya" : id === "dev" ? "Dev" : id);
  const verify = () => {
    const r = verifyChain(t.ledger);
    setChecked({ ok: r.ok, at: r.brokenAt, n: t.ledger.length });
    announce(r.ok ? `All ${t.ledger.length} ledger entries verified.` : `Chain broken at entry ${r.brokenAt}.`);
  };
  const reverse = async (e: LedgerEntry) => {
    if (isReversed(t.ledger, e.id)) return;
    const ok = await confirm({
      title: `Reverse entry ${e.seq}?`,
      description: `Posts a reversal of ${e.amount > 0 ? "−" : "+"}${Math.abs(e.amount)} ${meterOf(pack, e.meter).label} on ${name(e.account)}'s account as ${actor}. Entry ${e.seq} stays as it is; the chain records both.`,
      confirmLabel: "Post reversal",
    });
    if (!ok) return;
    const trial = reverseLedgerEntry(t, e.id, actor, `Correction of entry ${e.seq}`);
    if (trial.error) {
      toast.error(trial.error);
      announce(trial.error);
      return;
    }
    run((s) => reverseLedgerEntry(s, e.id, actor, `Correction of entry ${e.seq}`).state, `Entry ${e.seq} reversed.`);
  };
  const promo = (ev: FormEvent<HTMLFormElement>) => {
    ev.preventDefault();
    const f = new FormData(ev.currentTarget);
    const who = String(f.get("promo-account"));
    const meter = String(f.get("promo-meter"));
    const amount = Math.max(0, Number(f.get("promo-amount")) || 0);
    if (amount <= 0) {
      toast.error("Enter an amount above zero.");
      return;
    }
    const m = meterOf(pack, meter);
    run((s) => grantPromo(s, who, meter, amount, "Goodwill promo credits", actor).state, `${amountText(m, amount)} promo credits granted to ${name(who)}; they're spent first.`);
  };
  const lotAccounts = account === "all" ? (["maya", "dev"] as const) : ([account] as string[]);
  return (
    <section aria-labelledby="ledger-title" className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <SectionTitle id="ledger-title" aside={`${fmtNum(entries.length)} of ${fmtNum(t.ledger.length)} entries · each entry hashes the one before`}>
          Credit ledger
        </SectionTitle>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <NativeSelect size="sm" aria-label="Account" value={account} onChange={(e) => setAccount(e.target.value)}>
            <NativeSelectOption value="all">All accounts</NativeSelectOption>
            <NativeSelectOption value="maya">Maya</NativeSelectOption>
            <NativeSelectOption value="dev">Dev</NativeSelectOption>
          </NativeSelect>
          <Button size="sm" variant="outline" onClick={verify}>
            <ShieldCheck aria-hidden="true" />
            Verify chain
          </Button>
        </div>
      </div>
      {checked && (
        <p role="status" className={checked.ok ? "type-caption text-healthy-ink" : "type-caption text-blocked-ink"}>
          {checked.ok ? `All ${checked.n} entries verified: every hash matches the entry before it.` : `Chain broken at entry ${checked.at}.`}
        </p>
      )}
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0 space-y-2 rounded-xl border border-border bg-card p-4">
          <h3 className="type-body font-semibold">Spend order</h3>
          <p className="type-caption text-muted-foreground">Rewards and promos first, then plan and rollover credits soonest to expire, then top-ups. Holds draw in the same order and give back what a job didn't use. Balances can't go below zero{pack.ledgerPolicy.allowNegative ? ` beyond the ${pack.ledgerPolicy.overdraft} overdraft ${pack.company} allows` : ""}.</p>
          <div className="grid gap-3 md:grid-cols-2">
            {lotAccounts.flatMap((id) =>
              pack.meters.map((m) => {
                const lots = lotsOf(t.ledger, id, m.id);
                return (
                  <div key={`${id}-${m.id}`} className="min-w-0">
                    <div className="type-caption font-medium">
                      {name(id)} · {m.label}
                    </div>
                    {lots.length ? (
                      <ol className="mt-1 space-y-1">
                        {lots.map((l, i) => (
                          <li key={l.id} className="flex items-center gap-2 type-caption">
                            <span className="w-4 text-right num text-muted-foreground">{i + 1}</span>
                            <ToneBadge tone={SPEND_TIER[l.source] === 0 ? "reward" : SPEND_TIER[l.source] === 1 ? "info" : "healthy"}>{SOURCE_LABEL[l.source]}</ToneBadge>
                            <span className="num">{amountText(m, l.remaining, { label: false })}</span>
                            <span className="ml-auto text-muted-foreground">{l.expiresAt ? `expires ${fmtDate(l.expiresAt)}` : "no expiry"}</span>
                          </li>
                        ))}
                      </ol>
                    ) : (
                      <p className="mt-1 type-caption text-muted-foreground">Nothing left to spend.</p>
                    )}
                  </div>
                );
              }),
            )}
          </div>
        </div>
        <form onSubmit={promo} className="space-y-3 rounded-xl border border-border bg-card p-4">
          <h3 className="type-body font-semibold">Grant promo credits</h3>
          <p className="type-caption text-muted-foreground">Goodwill after a help chat: a promo grant, spent first, expiring in 30 days, posted as {actor}.</p>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label htmlFor="promo-account">Account</Label>
              <NativeSelect id="promo-account" name="promo-account" size="sm" defaultValue="maya" className="w-full">
                <NativeSelectOption value="maya">Maya</NativeSelectOption>
                <NativeSelectOption value="dev">Dev</NativeSelectOption>
              </NativeSelect>
            </div>
            <div className="space-y-1">
              <Label htmlFor="promo-meter">Meter</Label>
              <NativeSelect id="promo-meter" name="promo-meter" size="sm" defaultValue={pack.meters[0].id} className="w-full">
                {pack.meters.map((m) => (
                  <NativeSelectOption key={m.id} value={m.id}>
                    {m.label}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </div>
          </div>
          <div className="space-y-1">
            <Label htmlFor="promo-amount">Amount</Label>
            <Input id="promo-amount" name="promo-amount" type="number" min={0} step="any" defaultValue={pack.meters[0].valueType === "currency" ? 5 : 50} className="h-8" />
          </div>
          <Button type="submit" size="sm">
            Grant
          </Button>
        </form>
      </div>
      <LedgerTable key={account} pack={pack} entries={entries} accountName={name} onReverse={reverse} reversed={reversed} />
    </section>
  );
}

function EventsTab({ t }: { t: TenantState }) {
  const pack = t.pack;
  const [account, setAccount] = useState("all");
  const [type, setType] = useState("all");
  const [limit, setLimit] = useState(PAGE);
  const types = [...new Set(t.events.map((e) => e.type))].sort();
  const rows = t.events.filter((e) => (account === "all" || e.account === account) && (type === "all" || e.type === type)).slice().reverse();
  const name = (id: string) => (id === "maya" ? "Maya" : id === "dev" ? "Dev" : id === "tenant" ? pack.company : id);
  const STATUS_TONE = { ok: "healthy", stopped: "watch", blocked: "blocked", failed: "blocked", info: "info" } as const;

  return (
    <section aria-labelledby="events-title" className="space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <SectionTitle id="events-title" aside={`${fmtNum(rows.length)} of ${fmtNum(t.events.length)} events`}>
          Usage events
        </SectionTitle>
        <div className="ml-auto flex flex-wrap gap-2">
          <NativeSelect size="sm" aria-label="Account" value={account} onChange={(e) => { setAccount(e.target.value); setLimit(PAGE); }}>
            <NativeSelectOption value="all">All sources</NativeSelectOption>
            <NativeSelectOption value="maya">Maya</NativeSelectOption>
            <NativeSelectOption value="dev">Dev</NativeSelectOption>
            <NativeSelectOption value="tenant">{pack.company}</NativeSelectOption>
          </NativeSelect>
          <NativeSelect size="sm" aria-label="Event type" value={type} onChange={(e) => { setType(e.target.value); setLimit(PAGE); }}>
            <NativeSelectOption value="all">All types</NativeSelectOption>
            {types.map((x) => (
              <NativeSelectOption key={x} value={x}>{x}</NativeSelectOption>
            ))}
          </NativeSelect>
        </div>
      </div>
      <Table>
        <TableCaption className="sr-only">Usage event stream, newest first</TableCaption>
        <TableHeader>
          <TableRow>
            <TableHead scope="col">Event</TableHead>
            <TableHead scope="col">Time</TableHead>
            <TableHead scope="col">Source</TableHead>
            <TableHead scope="col">Type</TableHead>
            <TableHead scope="col">Detail</TableHead>
            <TableHead scope="col" className="text-right">Metered</TableHead>
            <TableHead scope="col">Status</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.slice(0, limit).map((e) => (
            <TableRow key={e.id}>
              <TableHead scope="row" className="font-mono text-xs font-normal">{e.id}</TableHead>
              <TableCell className="whitespace-nowrap tabular-nums">{fmtDateTime(e.ts)}</TableCell>
              <TableCell>{name(e.account)}</TableCell>
              <TableCell className="font-mono text-xs">{e.type}</TableCell>
              <TableCell className="max-w-[360px]">
                <div className="truncate" title={[e.workflow, e.step, e.note].filter(Boolean).join(" · ")}>
                  {[e.workflow, e.step].filter(Boolean).join(" · ") || eventLabel(e)}
                </div>
                <div className="truncate text-xs text-muted-foreground">{e.note}</div>
              </TableCell>
              <TableCell className="text-right text-xs tabular-nums">
                {Object.entries(e.meters ?? {}).map(([m, v]) => amountText(meterOf(pack, m), v)).join(" · ") || "—"}
              </TableCell>
              <TableCell><ToneBadge tone={STATUS_TONE[e.status]}>{e.status}</ToneBadge></TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {rows.length > limit && (
        <Button variant="ghost" size="sm" onClick={() => setLimit((l) => l + PAGE)}>
          Show {Math.min(PAGE, rows.length - limit)} more
        </Button>
      )}
    </section>
  );
}
