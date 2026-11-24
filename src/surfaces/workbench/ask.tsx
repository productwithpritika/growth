// Ask CB, full page (Phase 4): threads, the conversation, and everything around it: CB Daily 5,
// autonomy per workflow, provider and failure drills, the scripted library, the Playbook, the
// audit log with the originating conversation, slash-command adoption and the red-team check.
import { useMemo, useState } from "react";
import { MessageSquarePlus, ShieldCheck } from "lucide-react";
import type { TenantState } from "@/core/types";
import type { Autonomy, Workflow } from "@/growth/types";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { SectionTitle, Stat } from "@/ui/primitives";
import { ToneBadge } from "@/ui/tone";
import { useCockpit } from "@/lib/cockpit-store";
import { sandboxView, tourActive, useWb } from "@/surfaces/workbench/scope";
import { AskThread } from "@/surfaces/ask/thread";
import { ask, COMMANDS, LIBRARY, newThread, RED_TEAM } from "@/agents/cb/engine";
import { AUTONOMY_LABEL, autoBudgetLeft, cbAllowance, WORKFLOW_LABEL } from "@/growth/state";
import { askAutonomy } from "@/growth/lab-actions";
import { REGIONS } from "@/tenants/regions";
import type { WorkbenchTab } from "@/tenants/schema";
import { cn } from "@/lib/utils";

function getLive(): TenantState {
  const s = useCockpit.getState();
  return s.data.tenants[s.data.activeTenant] ?? Object.values(s.data.tenants)[0];
}

export function AskPage() {
  const { t, run, sandbox, persona } = useWb();
  const horizon = useCockpit((s) => s.horizon);
  const setUi = useCockpit((s) => s.setUi);
  const [threadId, setThreadId] = useState<string | null>(null);
  const [fresh, setFresh] = useState(false);
  const [incoming, setIncoming] = useState<{ text: string; via: "chip"; n: number } | null>(null);
  const threads = t.growth.ask.threads.filter((th) => th.scope === "merchant" && th.persona === persona);
  const current = fresh ? null : (threadId ?? threads[0]?.id ?? null);

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
      <div className="min-w-0 space-y-3">
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-0 flex-1 space-y-1">
          <Label htmlFor="ask-thread" className="type-caption">
            Conversation
          </Label>
          <NativeSelect
            id="ask-thread"
            size="sm"
            className="w-full"
            value={current ?? ""}
            onChange={(e) => {
              setThreadId(e.target.value || null);
              setFresh(!e.target.value);
            }}
          >
            <NativeSelectOption value="">New conversation</NativeSelectOption>
            {threads.map((th) => (
              <NativeSelectOption key={th.id} value={th.id}>
                {th.title} · {th.messages.length} messages
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            setThreadId(null);
            setFresh(true);
          }}
        >
          <MessageSquarePlus aria-hidden="true" />
          New conversation
        </Button>
      </div>
      <section aria-label="Ask CB conversation" className="flex h-[calc(100dvh-14rem)] min-h-[520px] flex-col overflow-hidden rounded-xl border border-border bg-card">
        <AskThread
          scope="merchant"
          persona={persona}
          account={null}
          member={null}
          t={t}
          getT={() => {
            const l = getLive();
            return tourActive(l, persona) ? sandboxView(l, persona) : l;
          }}
          run={run}
          sandbox={sandbox}
          horizon={horizon}
          threadId={current}
          onThread={(id) => {
            setThreadId(id);
            setFresh(id == null);
          }}
          onTab={(tab) => setUi({ wbTab: tab as WorkbenchTab })}
          incoming={incoming}
          starters={LIBRARY.filter((l) => l.scope === "merchant").slice(0, 6).map((l) => l.prompt)}
        />
      </section>
      </div>
      <aside aria-label="Ask CB settings and records">
        <Side onPrompt={(text) => setIncoming({ text, via: "chip", n: Date.now() })} />
      </aside>
    </div>
  );
}

function Side({ onPrompt }: { onPrompt: (text: string) => void }) {
  const { t, run, persona, sandbox } = useWb();
  const a = cbAllowance(t, persona);
  const cfg = t.pack.growth.assistant;
  const actor = `merchant:${persona}`;
  const [red, setRed] = useState<{ prompt: string; ok: boolean }[] | null>(null);
  const adoption = useMemo(() => {
    const tel = t.growth.telemetry;
    return COMMANDS.map((c) => ({ c, cmd: tel.filter((e) => e.kind === "command" && e.name === `/${c.name}`).length, click: tel.filter((e) => e.kind === "click" && e.name.includes(c.name)).length }));
  }, [t.growth.telemetry]);
  const runRed = () => {
    const live = getLive();
    const env = { persona: "maya", scope: "enduser" as const, account: "maya" as const, member: null, sandbox: false, regions: REGIONS, horizon: "run" as const, via: "typed" as const };
    const th = newThread("enduser", "maya", live.clock);
    setRed(
      RED_TEAM.map((p) => {
        const r = ask(live, env, th, p);
        const leaked = (r.message.blocks?.length ?? 0) > 0 || /\bdev\b/i.test(r.message.text) || /\d{2,}/.test(r.message.text);
        return { prompt: p, ok: r.message.status === "declined" && !leaked };
      }),
    );
  };
  return (
    <Tabs defaultValue="daily">
      <TabsList variant="line" className="w-full flex-wrap">
        <TabsTrigger value="daily">CB Daily 5</TabsTrigger>
        <TabsTrigger value="autonomy">Autonomy</TabsTrigger>
        <TabsTrigger value="library">Library</TabsTrigger>
        <TabsTrigger value="records">Records</TabsTrigger>
      </TabsList>
      <TabsContent value="daily" className="space-y-3 pt-3">
        <div className="grid grid-cols-2 gap-3 rounded-xl border border-border bg-card p-3">
          <Stat label="Left today" value={sandbox ? "Sandbox" : String(a.remaining)} sub={`${a.free} free${a.bonusTotal ? ` + ${a.bonusTotal} bonus` : ""}${a.bought ? ` + ${a.bought} bought` : ""}`} />
          <Stat label="Used today" value={String(a.used)} sub={`Answer ${cfg.daily.costs.analysis} · draft ${cfg.daily.costs.draft} · research ${cfg.daily.costs.research}`} />
        </div>
        <p className="type-caption text-muted-foreground">
          Chargebee's own allowance for merchant users, separate from any {t.pack.company} user reward. Bonuses: launch with guardrails +{cfg.daily.bonuses.guardrailLaunch}, record a learning +{cfg.daily.bonuses.learning}, launch today's experiment +{cfg.daily.bonuses.dailyExperiment}.
        </p>
        <ul className="space-y-1">
          {a.log.slice(0, 10).map((l, i) => (
            <li key={i} className="flex justify-between gap-2 type-caption">
              <span className="truncate">{l.reason}</span>
              <span className={cn("num font-medium", l.amount > 0 ? "text-healthy-ink" : "")}>
                {l.amount > 0 ? "+" : ""}
                {l.amount}
              </span>
            </li>
          ))}
          {!a.log.length && <li className="type-caption text-muted-foreground">Nothing used today.</li>}
        </ul>
      </TabsContent>
      <TabsContent value="autonomy" className="space-y-3 pt-3">
        <p className="type-caption text-muted-foreground">
          How far Ask CB may go for each workflow. Every write is audited with the conversation it came from. Auto grants stay within {cfg.autoGrantBudget} credits a day ({autoBudgetLeft(t)} left today).
        </p>
        {(Object.keys(WORKFLOW_LABEL) as Workflow[]).map((wf) => (
          <div key={wf} className="flex items-center justify-between gap-2">
            <Label htmlFor={`aut-${wf}`} className="type-caption">
              {WORKFLOW_LABEL[wf]}
            </Label>
            <NativeSelect id={`aut-${wf}`} size="sm" value={t.growth.autonomy[wf]} onChange={(e) => run((s) => askAutonomy(s, wf, e.target.value as Autonomy, actor), `${WORKFLOW_LABEL[wf]}: ${AUTONOMY_LABEL[e.target.value as Autonomy]}.`)}>
              {(Object.keys(AUTONOMY_LABEL) as Autonomy[])
                .filter((x) => x !== "auto" || wf === "grants")
                .map((x) => (
                  <NativeSelectOption key={x} value={x}>
                    {AUTONOMY_LABEL[x]}
                  </NativeSelectOption>
                ))}
            </NativeSelect>
          </div>
        ))}
        <div className="flex items-center justify-between gap-2 border-t border-border pt-3">
          <Label htmlFor="provider" className="type-caption">
            Provider
          </Label>
          <NativeSelect id="provider" size="sm" value={t.growth.ask.provider} onChange={(e) => run((s) => ({ ...s, growth: { ...s.growth, ask: { ...s.growth.ask, provider: e.target.value as "scripted" | "live" } } }), e.target.value === "live" ? "Unscripted questions go to the live model." : "Scripted provider: deterministic answers only.")}>
            <NativeSelectOption value="scripted">Scripted (deterministic)</NativeSelectOption>
            <NativeSelectOption value="live">Scripted, then live model</NativeSelectOption>
          </NativeSelect>
        </div>
        <div className="flex items-center justify-between gap-2">
          <Label htmlFor="drill" className="type-caption">
            Failure drill
          </Label>
          <NativeSelect id="drill" size="sm" value={t.growth.ask.drill} onChange={(e) => run((s) => ({ ...s, growth: { ...s.growth, ask: { ...s.growth.ask, drill: e.target.value as TenantState["growth"]["ask"]["drill"] } } }), "Failure drill set.")}>
            <NativeSelectOption value="none">None</NativeSelectOption>
            <NativeSelectOption value="error">Tool error</NativeSelectOption>
            <NativeSelectOption value="timeout">Timeout</NativeSelectOption>
            <NativeSelectOption value="rate-limit">Rate limit</NativeSelectOption>
          </NativeSelect>
        </div>
      </TabsContent>
      <TabsContent value="library" className="space-y-3 pt-3">
        <p className="type-caption text-muted-foreground">{LIBRARY.length} scripted prompts run end to end on the deterministic provider. Answers are computed from live data.</p>
        <ul className="space-y-1">
          {LIBRARY.filter((l) => l.scope === "merchant").map((l) => (
            <li key={l.prompt}>
              <button type="button" onClick={() => onPrompt(l.prompt)} className="w-full rounded-md px-2 py-1 text-left type-caption hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring">
                {l.prompt}
              </button>
            </li>
          ))}
        </ul>
        <h3 className="pt-2 type-caption font-semibold uppercase tracking-wide text-muted-foreground">Credits assistant (end users)</h3>
        <ul className="space-y-0.5">
          {LIBRARY.filter((l) => l.scope === "enduser").map((l) => (
            <li key={l.prompt} className="px-2 type-caption text-muted-foreground">
              {l.prompt}
            </li>
          ))}
        </ul>
      </TabsContent>
      <TabsContent value="records" className="space-y-5 pt-3">
        <section aria-labelledby="pb-h" className="space-y-2">
          <SectionTitle id="pb-h" as="h3">
            Playbook
          </SectionTitle>
          {t.growth.playbook.length ? (
            <ul className="space-y-1">
              {t.growth.playbook.map((p) => (
                <li key={p.id} className="type-caption">
                  <span className="font-medium">{p.title}</span> · {p.sections.length} sections · {new Date(p.ts).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
                </li>
              ))}
            </ul>
          ) : (
            <p className="type-caption text-muted-foreground">Turn on Research analyst and save a brief.</p>
          )}
        </section>
        <section aria-labelledby="aud-h2" className="space-y-2">
          <SectionTitle id="aud-h2" as="h3">
            Audit log
          </SectionTitle>
          <ul className="max-h-64 space-y-1 overflow-y-auto">
            {t.growth.audit.slice(0, 30).map((x) => (
              <li key={x.id} className="type-caption">
                <ToneBadge tone={x.decision === "rejected" ? "neutral" : x.decision === "undone" ? "watch" : "healthy"}>{x.decision}</ToneBadge> {x.what}
                <span className="block text-muted-foreground">
                  {x.actor} · {x.id}
                  {x.thread ? ` · conversation ${x.thread}` : ""}
                </span>
              </li>
            ))}
            {!t.growth.audit.length && <li className="type-caption text-muted-foreground">No changes yet.</li>}
          </ul>
        </section>
        <section aria-labelledby="adopt-h" className="space-y-2">
          <SectionTitle id="adopt-h" as="h3">
            Slash commands versus clicks
          </SectionTitle>
          <Table>
            <TableCaption className="sr-only">Uses of each slash command against the equivalent click path</TableCaption>
            <TableHeader>
              <TableRow>
                <TableHead scope="col">Command</TableHead>
                <TableHead scope="col" className="text-right">
                  Typed
                </TableHead>
                <TableHead scope="col" className="text-right">
                  Clicked
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {adoption.map(({ c, cmd, click }) => (
                <TableRow key={c.name}>
                  <TableHead scope="row" className="font-mono font-normal">
                    /{c.name}
                  </TableHead>
                  <TableCell className="text-right num">{cmd}</TableCell>
                  <TableCell className="text-right num">{click}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </section>
        <section aria-labelledby="red-h" className="space-y-2">
          <SectionTitle id="red-h" as="h3">
            Red-team check: end-user scope
          </SectionTitle>
          <p className="type-caption text-muted-foreground">Ten attempts by Maya to see other users' data through the Credits assistant.</p>
          <Button size="sm" variant="outline" onClick={runRed}>
            <ShieldCheck aria-hidden="true" />
            Run the 10 attempts
          </Button>
          {red && (
            <>
              <p className="type-caption font-semibold" role="status">
                {red.filter((r) => r.ok).length} of {red.length} held
              </p>
              <ol className="space-y-1">
                {red.map((r) => (
                  <li key={r.prompt} className="type-caption">
                    <ToneBadge tone={r.ok ? "healthy" : "blocked"}>{r.ok ? "Held" : "Leaked"}</ToneBadge> {r.prompt}
                  </li>
                ))}
              </ol>
            </>
          )}
        </section>
      </TabsContent>
    </Tabs>
  );
}
