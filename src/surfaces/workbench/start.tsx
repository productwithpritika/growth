// Get started (Phase 3): connect and consent, seven ingestion lanes with real progress, Memory
// cards with Edit and Forget, at most five clarifying questions, and the WOW reveal with a live
// Time to first experiment clock. Progress persists: close the tab and it resumes where it was.
import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, ArrowRight, Check, Clock, Database, Pause, Pencil, Play, PlugZap, RotateCcw, ShieldCheck, Undo2, X } from "lucide-react";
import type { TenantState } from "@/core/types";
import type { DrillId, GrowthState, LaneRun, MemoryCard, SourceId } from "@/growth/types";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Checkbox } from "@/components/ui/checkbox";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { SectionTitle, Stat } from "@/ui/primitives";
import { ToneBadge } from "@/ui/tone";
import { useCockpit } from "@/lib/cockpit-store";
import { useWb } from "@/surfaces/workbench/scope";
import { REGIONS } from "@/tenants/regions";
import { answerQuestion, cardsFromSource, clock, connect, findings, initialOnboarding, LANES, laneCards, laneDef, laneStatusLabel, laneTotal, QUESTIONS, questionOptions, residency, retryConnector, SOURCES, sourceDef, tickOnboarding, chargebeeOnly, withdrawSource } from "@/growth/onboarding";
import { audit, editCard, forgetCard, learnCards, track } from "@/growth/state";
import { startTour, TOUR_STEPS, ttfe } from "@/growth/tour";
import { fmtNum, fmtUsd } from "@/core/format";
import type { WorkbenchTab } from "@/tenants/schema";
import { cn } from "@/lib/utils";

const DRILLS: { id: DrillId; label: string; needs?: SourceId }[] = [
  { id: "source-fails", label: "Help chat fails to connect", needs: "helpchat" },
  { id: "slow-connector", label: "Product analytics is slow", needs: "analytics" },
  { id: "partial-data", label: "Product analytics returns partial data", needs: "analytics" },
  { id: "no-policy-region", label: "Invoices in a region with no policy pack" },
];

const LANE_TONE: Record<LaneRun["status"], "neutral" | "info" | "watch" | "healthy" | "blocked"> = { queued: "neutral", connecting: "info", reading: "info", understanding: "info", "needs-you": "watch", done: "healthy", skipped: "neutral", failed: "blocked" };
const CONN_LABEL = { native: "Chargebee native", off: "Not connected", connecting: "Connecting", slow: "Slow", failed: "Failed", connected: "Connected", partial: "Partial data", fallback: "Using Chargebee data only", forgotten: "Forgotten" } as const;
const CONF_TONE = { high: "healthy", medium: "info", low: "watch" } as const;

export function useTtfe(t: TenantState): number {
  const [now, setNow] = useState(() => Date.now());
  const o = t.growth.onboarding;
  const ticking = o.firstExperimentAt == null && !!o.realSince;
  useEffect(() => {
    if (!ticking) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [ticking]);
  return ttfe(o, now);
}

export function StartPanel() {
  const { t, run, persona } = useWb();
  const o = t.growth.onboarding;
  const setUi = useCockpit((s) => s.setUi);
  const elapsed = useTtfe(t);
  const ev = (s: TenantState, kind: Parameters<typeof track>[1]["kind"], name: string, detail: string): TenantState => ({ ...s, growth: track(s.growth, { ts: new Date().toISOString(), sim: Math.round(ttfe(s.growth.onboarding)), session: s.growth.onboarding.sessionId, persona, kind, name, detail }) });

  // Ingestion ticks: simulated seconds at the chosen speed. Stops itself at the reveal.
  const ingesting = o.stage === "ingest" && !o.paused;
  const runRef = useRef(run);
  useEffect(() => {
    runRef.current = run;
  });
  useEffect(() => {
    if (!ingesting) return;
    const id = window.setInterval(() => {
      runRef.current(
        (s) => {
          const r = tickOnboarding(s, s.growth.onboarding, 0.7 * s.growth.onboarding.speed, { regions: REGIONS }, s.pack.growth.assistant.maxQuestions);
          let g = learnCards(s.growth, r.cards, s.clock);
          g = { ...g, onboarding: r.o.stage === "reveal" && !r.o.realSince ? { ...r.o, realSince: new Date().toISOString() } : r.o };
          for (const e of r.events) if (e.kind !== "card") g = track(g, { ts: new Date().toISOString(), sim: Math.round(r.o.simSeconds), session: r.o.sessionId, persona, kind: e.kind === "connector" ? "connector" : e.kind === "question" ? "question" : "lane", name: e.name, detail: e.detail });
          return { ...s, growth: g };
        },
        "",
        { quiet: true },
      );
    }, 700);
    return () => window.clearInterval(id);
  }, [ingesting, persona]);

  if (o.stage === "consent") return <Consent />;

  const asked = o.questions.filter((q) => q.status !== "waiting").length;
  const done = o.lanes.filter((l) => l.status === "done" || l.status === "skipped").length;
  const reveal = o.stage === "reveal" || o.stage === "done";

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4 rounded-xl border border-border bg-card p-4">
        <div className="min-w-0">
          <p className="type-caption font-semibold uppercase tracking-wide text-muted-foreground">{reveal ? "Learned" : "Learning your business"}</p>
          <h2 className="type-heading">{reveal ? `${t.pack.company}, in one view` : `Reading ${t.pack.company}'s data, in front of you`}</h2>
          <p className="type-caption text-muted-foreground">
            {done} of {LANES.length} lanes finished · {t.growth.memory.filter((c) => !c.forgotten).length} Memory cards · {asked} of {t.pack.growth.assistant.maxQuestions} questions asked
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-4">
          <div aria-live="off" className="text-right">
            <div className="flex items-center justify-end gap-1 type-caption font-medium text-muted-foreground">
              <Clock aria-hidden="true" className="size-3.5" />
              Time to first experiment
            </div>
            <div className={cn("type-title num", o.firstExperimentAt != null ? "text-healthy-ink" : "")} data-testid="ttfe">
              {clock(elapsed)}
            </div>
            <div className="type-caption text-muted-foreground">{o.firstExperimentAt != null ? "Stopped at first launch" : "Simulated time since Connect · target under 10:00"}</div>
          </div>
          {o.stage === "ingest" && (
            <div className="flex items-center gap-2">
              <Button size="sm" variant="outline" onClick={() => run((s) => ev({ ...s, growth: { ...s.growth, onboarding: { ...s.growth.onboarding, paused: !s.growth.onboarding.paused } } }, "lane", o.paused ? "resume" : "pause", ""), "", { quiet: true })}>
                {o.paused ? <Play aria-hidden="true" /> : <Pause aria-hidden="true" />}
                {o.paused ? "Resume" : "Pause"}
              </Button>
              <Label htmlFor="speed" className="sr-only">
                Speed
              </Label>
              <select id="speed" className="h-8 rounded-md border border-border bg-background px-2 text-sm" value={o.speed} onChange={(e) => run((s) => ({ ...s, growth: { ...s.growth, onboarding: { ...s.growth.onboarding, speed: Number(e.target.value) } } }), "", { quiet: true })}>
                {[1, 3, 6, 12].map((v) => (
                  <option key={v} value={v}>
                    {v}× speed
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>
      </div>

      <SourcesStrip />

      {reveal && <Reveal elapsed={elapsed} />}

      <section aria-labelledby="lanes-h" className="space-y-3">
        <SectionTitle id="lanes-h" aside="Real progress over your data, scaled from the simulated sample">
          Ingestion
        </SectionTitle>
        <ol className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          {o.lanes.map((l, i) => (
            <Lane key={l.id} l={l} n={i + 1} />
          ))}
        </ol>
      </section>

      <MemoryPanel />
      <JourneyAnalytics />

      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="ghost"
          onClick={() =>
            run((s) => ev({ ...s, growth: { ...s.growth, memory: [], onboarding: { ...initialOnboarding(`onb-${Date.now().toString(36)}`), sources: s.growth.onboarding.sources, drills: s.growth.onboarding.drills } } }, "consent", "restart", "Onboarding restarted"), "Onboarding restarted.")
          }
        >
          <RotateCcw aria-hidden="true" />
          Start onboarding again
        </Button>
        {reveal && (
          <Button size="sm" variant="ghost" onClick={() => setUi({ wbTab: "today" })}>
            Go to Today
            <ArrowRight aria-hidden="true" />
          </Button>
        )}
      </div>
    </div>
  );
}

function Consent() {
  const { t, run, persona } = useWb();
  const o = t.growth.onboarding;
  const toggle = (id: SourceId, v: boolean) => run((s) => ({ ...s, growth: { ...s.growth, onboarding: { ...s.growth.onboarding, sources: { ...s.growth.onboarding.sources, [id]: v } } } }), "", { quiet: true });
  const drill = (d: (typeof DRILLS)[number], v: boolean) =>
    run((s) => {
      const on = v ? [...new Set([...s.growth.onboarding.drills, d.id])] : s.growth.onboarding.drills.filter((x) => x !== d.id);
      const sources = d.needs && v ? { ...s.growth.onboarding.sources, [d.needs]: true } : s.growth.onboarding.sources;
      return { ...s, growth: { ...s.growth, onboarding: { ...s.growth.onboarding, drills: on, sources } } };
    }, "", { quiet: true });
  const start = () =>
    run((s) => {
      const at = new Date().toISOString();
      const on = SOURCES.filter((x) => s.growth.onboarding.sources[x.id]).map((x) => x.id);
      let g: GrowthState = { ...s.growth, onboarding: connect(s.growth.onboarding, at), memory: [] };
      g = track(g, { ts: at, sim: 0, session: g.onboarding.sessionId, persona, kind: "consent", name: "connect", detail: `Sources: ${on.join(", ")}` });
      g = audit(g, { ts: s.clock, actor: `merchant:${persona}`, workflow: "onboarding", what: `Connected ${on.length} sources (read-only)`, decision: "approved", thread: null, message: null, diff: SOURCES.map((x) => ({ path: `sources.${x.id}`, before: "off", after: s.growth.onboarding.sources[x.id] ? "read-only" : "declined" })) }).g;
      return { ...s, growth: g };
    }, "Connected. Chargebee data appears first; connectors follow.");
  return (
    <section aria-labelledby="consent-h" className="mx-auto max-w-4xl space-y-5">
      <div className="space-y-2">
        <p className="type-caption font-semibold uppercase tracking-wide text-muted-foreground">Connect {t.pack.company} to Chargebee</p>
        <h2 id="consent-h" className="type-title">Choose what Chargebee may read</h2>
        <p className="type-body text-muted-foreground">
          Within authorised limits: every source is read-only, no raw personal data leaves {t.pack.company}'s tenant, and each one has a Forget control afterwards. Data stays in {residency(t)}. The minimum set is
          already on; declining anything never blocks onboarding, and I'll say what I won't know.
        </p>
      </div>
      <ul className="space-y-3">
        {SOURCES.map((s) => {
          const on = o.sources[s.id];
          return (
            <li key={s.id} className={cn("rounded-xl border p-4", on ? "border-primary/40 bg-card" : "border-border bg-card")}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Database aria-hidden="true" className="size-4 text-muted-foreground" />
                    <h3 className="type-body font-semibold">{s.name}</h3>
                    <ToneBadge tone={s.kind === "native" ? "info" : "neutral"}>{s.kind === "native" ? "Chargebee native" : "Connector"}</ToneBadge>
                    {s.minimum && <ToneBadge tone="healthy">Minimum set</ToneBadge>}
                  </div>
                  <p className="type-caption">
                    <span className="font-medium">Why:</span> {s.why}
                  </p>
                  <dl className="grid gap-x-4 gap-y-0.5 type-caption text-muted-foreground sm:grid-cols-2">
                    <div>
                      <dt className="inline font-medium text-foreground">Reads: </dt>
                      <dd className="inline">{s.reads}</dd>
                    </div>
                    <div>
                      <dt className="inline font-medium text-foreground">Stores: </dt>
                      <dd className="inline">{s.stores}</dd>
                    </div>
                    <div>
                      <dt className="inline font-medium text-foreground">Keeps it: </dt>
                      <dd className="inline">{s.retention}</dd>
                    </div>
                    <div>
                      <dt className="inline font-medium text-foreground">Scopes: </dt>
                      <dd className="inline font-mono">{s.scopes}</dd>
                    </div>
                  </dl>
                  {!on && <p className="type-caption text-watch-ink">Without it: {s.withoutIt}</p>}
                </div>
                <div className="flex items-center gap-2">
                  <Switch id={`src-${s.id}`} checked={on} onCheckedChange={(v) => toggle(s.id, v)} />
                  <Label htmlFor={`src-${s.id}`} className="type-caption">
                    {on ? "Read" : "Don't read"}
                  </Label>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
      <Collapsible>
        <CollapsibleTrigger asChild>
          <Button size="sm" variant="ghost">
            <AlertTriangle aria-hidden="true" />
            Failure drills for the demo
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <fieldset className="mt-2 space-y-2 rounded-lg border border-border p-3">
            <legend className="px-1 type-caption font-semibold">Make something go wrong on purpose</legend>
            {DRILLS.map((d) => (
              <div key={d.id} className="flex items-center gap-2">
                <Checkbox id={`drill-${d.id}`} checked={o.drills.includes(d.id)} onCheckedChange={(v) => drill(d, v === true)} />
                <Label htmlFor={`drill-${d.id}`} className="type-caption font-normal">
                  {d.label}
                </Label>
              </div>
            ))}
            <p className="type-caption text-muted-foreground">Consent can also be withdrawn mid-run (Forget on any source), and closing the tab resumes where it left off.</p>
          </fieldset>
        </CollapsibleContent>
      </Collapsible>
      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={start} data-tour="connect">
          <PlugZap aria-hidden="true" />
          Connect and start learning
        </Button>
        <span className="flex items-center gap-1.5 type-caption text-muted-foreground">
          <ShieldCheck aria-hidden="true" className="size-4" />
          Read-only. Nothing in {t.pack.company}'s configuration changes without your approval.
        </span>
      </div>
    </section>
  );
}

function SourcesStrip() {
  const { t, run, persona } = useWb();
  const o = t.growth.onboarding;
  const forget = (id: SourceId) =>
    run((s) => {
      const ids = cardsFromSource(s.growth.memory, id);
      let g = { ...s.growth, onboarding: withdrawSource(s.growth.onboarding, id) };
      for (const c of ids) g = forgetCard(g, c, true, persona, s.clock);
      g = track(g, { ts: new Date().toISOString(), sim: Math.round(ttfe(o)), session: o.sessionId, persona, kind: "consent", name: `withdraw.${id}`, detail: `${ids.length} cards forgotten` });
      g = audit(g, { ts: s.clock, actor: `merchant:${persona}`, workflow: "onboarding", what: `Consent withdrawn: ${sourceDef(id).name}`, decision: "approved", thread: null, message: null, diff: [{ path: `sources.${id}`, before: "read-only", after: "forgotten" }] }).g;
      return { ...s, growth: g };
    }, `${sourceDef(id).name} forgotten. Cards it produced are forgotten too.`);
  const fallback = (id: SourceId) => run((s) => ({ ...s, growth: track({ ...s.growth, onboarding: chargebeeOnly(s.growth.onboarding, id) }, { ts: new Date().toISOString(), sim: Math.round(ttfe(o)), session: o.sessionId, persona, kind: "connector", name: `${id}.fallback`, detail: "Chargebee data only" }) }), "Continuing with Chargebee data only.");
  const retry = (id: SourceId) => run((s) => ({ ...s, growth: { ...s.growth, onboarding: retryConnector(s.growth.onboarding, id) } }), `Retrying ${sourceDef(id).name}.`);
  return (
    <section aria-labelledby="src-h" className="space-y-2">
      <h3 id="src-h" className="type-caption font-semibold uppercase tracking-wide text-muted-foreground">
        Sources
      </h3>
      <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
        {SOURCES.map((s) => {
          const c = o.connectors[s.id];
          const tone = c === "failed" ? "blocked" : c === "slow" || c === "partial" ? "watch" : c === "connected" || c === "native" ? "healthy" : c === "connecting" ? "info" : "neutral";
          return (
            <li key={s.id} className="flex min-w-0 flex-col gap-2 rounded-lg border border-border bg-card p-3">
              <div className="flex min-w-0 items-center justify-between gap-2">
                <span className="truncate type-caption font-semibold" title={s.name}>
                  {s.name}
                </span>
                <ToneBadge tone={tone}>{CONN_LABEL[c]}</ToneBadge>
              </div>
              <div className="flex flex-wrap gap-1">
                {(c === "slow" || c === "connecting") && s.kind === "connector" && (
                  <Button size="xs" variant="outline" onClick={() => fallback(s.id)}>
                    Use Chargebee data only for now
                  </Button>
                )}
                {c === "failed" && (
                  <>
                    <Button size="xs" variant="outline" onClick={() => retry(s.id)}>
                      Retry
                    </Button>
                    <Button size="xs" variant="outline" onClick={() => fallback(s.id)}>
                      Use Chargebee data only
                    </Button>
                  </>
                )}
                {c !== "off" && c !== "forgotten" && (
                  <Button size="xs" variant="ghost" onClick={() => forget(s.id)}>
                    Forget this source
                  </Button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function Lane({ l, n }: { l: LaneRun; n: number }) {
  const { t, run, persona } = useWb();
  const o = t.growth.onboarding;
  const def = laneDef(l.id);
  const q = o.questions.find((x) => x.lane === l.id && x.status === "asked");
  const qdef = q ? QUESTIONS.find((x) => x.id === q.id) : null;
  const total = laneTotal(t, l.id);
  const cards = l.chips.map((id) => t.growth.memory.find((c) => c.id === id)).filter((c): c is MemoryCard => !!c);
  const answer = (value: string | null) =>
    run((s) => {
      let g = { ...s.growth, onboarding: answerQuestion(s.growth.onboarding, q!.id, value, s.clock) };
      g = learnCards(g, laneCards(s, l.id, { regions: REGIONS }, g.onboarding), s.clock);
      g = track(g, { ts: new Date().toISOString(), sim: Math.round(ttfe(g.onboarding)), session: g.onboarding.sessionId, persona, kind: "question", name: `${q!.id}.${value == null ? "skipped" : "answered"}`, detail: value ?? "skipped" });
      if (value != null) g = audit(g, { ts: s.clock, actor: `merchant:${persona}`, workflow: "memory", what: `Answered: ${qdef?.ask(s, s.growth.onboarding) ?? q!.id}`, decision: "recorded", thread: null, message: null, diff: [{ path: `memory.${qdef?.card}`, before: "assumed", after: value }] }).g;
      return { ...s, growth: g };
    }, value == null ? "Skipped. I'll keep my assumption and mark it low confidence." : "Thanks, the Memory card is updated.");
  return (
    <li className="min-w-0 space-y-2 rounded-xl border border-border bg-card p-4" aria-labelledby={`lane-${l.id}`}>
      <div className="flex items-start justify-between gap-2">
        <h3 id={`lane-${l.id}`} className="type-body font-semibold">
          {n}. {def.title}
        </h3>
        <ToneBadge tone={LANE_TONE[l.status]}>{laneStatusLabel(l.status)}</ToneBadge>
      </div>
      <Progress value={Math.round(l.progress * 100)} aria-label={`${def.title}: ${Math.round(l.progress * 100)}%`} />
      <p className="type-caption text-muted-foreground num">
        {fmtNum(Math.min(l.count, total))} of {fmtNum(total)} {def.unit}
        {l.partial ? " · partial" : ""}
      </p>
      {cards.length > 0 && (
        <ul className="flex flex-wrap gap-1.5" aria-label="What we learned">
          {cards.map((c) => (
            <li key={c.id} className={cn("rounded-full border px-2 py-0.5 type-caption", c.forgotten ? "border-dashed text-muted-foreground line-through" : "border-border bg-muted/50")} title={c.value}>
              {c.title}
            </li>
          ))}
        </ul>
      )}
      {l.note && <p className={cn("type-caption", l.status === "failed" ? "text-blocked-ink" : "text-muted-foreground")}>{l.note}</p>}
      {q && qdef && (
        <div className="rounded-lg border border-watch bg-watch-soft p-3" role="group" aria-label="Question from the agent">
          <p className="type-caption font-semibold text-watch-ink">{qdef.ask(t, o)}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {questionOptions(t, qdef).map((opt) => (
              <Button key={opt.value} size="xs" variant="outline" className="bg-background" onClick={() => answer(opt.value)}>
                {opt.label}
              </Button>
            ))}
            <Button size="xs" variant="ghost" onClick={() => answer(null)}>
              Skip
            </Button>
          </div>
        </div>
      )}
    </li>
  );
}

function MemoryPanel() {
  const { t, run, persona } = useWb();
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const cards = t.growth.memory;
  const save = (c: MemoryCard) =>
    run((s) => {
      let g = editCard(s.growth, c.id, draft, persona, s.clock);
      g = track(g, { ts: new Date().toISOString(), sim: null, session: s.growth.onboarding.sessionId, persona, kind: "card", name: `${c.id}.edited`, detail: draft.slice(0, 80) });
      g = audit(g, { ts: s.clock, actor: `merchant:${persona}`, workflow: "memory", what: `Edited Memory card: ${c.title}`, decision: "recorded", thread: null, message: null, diff: [{ path: `memory.${c.id}`, before: c.value, after: draft }] }).g;
      return { ...s, growth: g };
    }, "Memory card updated.");
  const forget = (c: MemoryCard, v: boolean) =>
    run((s) => {
      let g = forgetCard(s.growth, c.id, v, persona, s.clock);
      g = track(g, { ts: new Date().toISOString(), sim: null, session: s.growth.onboarding.sessionId, persona, kind: "card", name: `${c.id}.${v ? "forgotten" : "restored"}`, detail: c.title });
      g = audit(g, { ts: s.clock, actor: `merchant:${persona}`, workflow: "memory", what: `${v ? "Forgot" : "Restored"} Memory card: ${c.title}`, decision: "recorded", thread: null, message: null, diff: [] }).g;
      return { ...s, growth: g };
    }, v ? `Forgot "${c.title}". The reveal updates.` : `Restored "${c.title}".`);
  if (!cards.length) return null;
  return (
    <section aria-labelledby="mem-h" className="space-y-3">
      <SectionTitle id="mem-h" aside={`${cards.filter((c) => !c.forgotten).length} remembered · ${cards.filter((c) => c.forgotten).length} forgotten`}>
        Memory cards
      </SectionTitle>
      <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {cards.map((c) => (
          <li key={c.id} className={cn("space-y-2 rounded-xl border p-3", c.forgotten ? "border-dashed border-border bg-muted/30" : "border-border bg-card")}>
            <div className="flex items-start justify-between gap-2">
              <h3 className={cn("type-caption font-semibold", c.forgotten && "line-through")}>{c.title}</h3>
              <ToneBadge tone={c.forgotten ? "neutral" : CONF_TONE[c.confidence]}>{c.forgotten ? "Forgotten" : `${c.confidence} confidence`}</ToneBadge>
            </div>
            {editing === c.id ? (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  save(c);
                  setEditing(null);
                }}
                className="space-y-2"
              >
                <Label htmlFor={`edit-${c.id}`} className="sr-only">
                  Edit {c.title}
                </Label>
                <Input id={`edit-${c.id}`} value={draft} onChange={(e) => setDraft(e.target.value)} />
                <div className="flex gap-2">
                  <Button size="xs" type="submit" disabled={!draft.trim()}>
                    Save
                  </Button>
                  <Button size="xs" type="button" variant="ghost" onClick={() => setEditing(null)}>
                    Cancel
                  </Button>
                </div>
              </form>
            ) : (
              <p className={cn("type-caption", c.forgotten && "text-muted-foreground")}>{c.value}</p>
            )}
            <p className="type-caption text-muted-foreground">
              {c.source} · updated {new Date(c.updatedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
              {c.edited ? " · edited" : ""}
            </p>
            <div className="flex gap-1">
              {!c.forgotten && (
                <Button
                  size="xs"
                  variant="ghost"
                  onClick={() => {
                    setEditing(c.id);
                    setDraft(c.value);
                  }}
                  aria-label={`Edit ${c.title}`}
                >
                  <Pencil aria-hidden="true" />
                  Edit
                </Button>
              )}
              <Button size="xs" variant="ghost" onClick={() => forget(c, !c.forgotten)} aria-label={`${c.forgotten ? "Restore" : "Forget"} ${c.title}`}>
                {c.forgotten ? <Undo2 aria-hidden="true" /> : <X aria-hidden="true" />}
                {c.forgotten ? "Restore" : "Forget"}
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Reveal({ elapsed }: { elapsed: number }) {
  const { t, run, persona } = useWb();
  const setUi = useCockpit((s) => s.setUi);
  const f = useMemo(() => findings(t, t.growth.memory), [t]);
  const o = t.growth.onboarding;
  const tour = t.growth.tours[persona];
  const runRef = useRef(run);
  useEffect(() => {
    runRef.current = run;
  });
  useEffect(() => {
    if (o.revealSeenAt == null) runRef.current((s) => ({ ...s, growth: track({ ...s.growth, onboarding: { ...s.growth.onboarding, revealSeenAt: Math.round(ttfe(s.growth.onboarding)) } }, { ts: new Date().toISOString(), sim: Math.round(ttfe(s.growth.onboarding)), session: s.growth.onboarding.sessionId, persona, kind: "reveal", name: "reveal.view", detail: `${f.shown.length} findings` }) }), "", { quiet: true });
  }, [o.revealSeenAt, persona, f.shown.length]);
  const explore = (x: (typeof f.shown)[number]) => {
    run((s) => ({ ...s, growth: track(s.growth, { ts: new Date().toISOString(), sim: Math.round(ttfe(s.growth.onboarding)), session: s.growth.onboarding.sessionId, persona, kind: "reveal", name: `explore.${x.id}`, detail: x.title }) }), "", { quiet: true });
    if (x.explore.prompt) setUi({ askOpen: true, askPrompt: { text: x.explore.prompt, via: "chip", n: Date.now() } });
    else setUi({ wbTab: x.explore.tab as WorkbenchTab, ...(x.explore.segment ? { segment: x.explore.segment } : {}) });
  };
  const launch = () => {
    run((s) => startTour(s, persona), "The tour starts in a sandbox copy. Take over at any step.");
    setUi({ askOpen: false, askThreadId: null, segment: "" });
  };
  return (
    <section aria-labelledby="reveal-h" className="space-y-4 rounded-2xl border border-primary/30 bg-card p-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 id="reveal-h" className="type-title">
            Your monetization, in one view
          </h2>
          <p className="type-body text-muted-foreground">Five findings from the simulator, each with its evidence. Impact ranges are estimates, not results.</p>
        </div>
        <Stat label="Time to first experiment" value={clock(elapsed)} sub={o.firstExperimentAt != null ? "First experiment launched" : "Still counting"} />
      </div>
      <ol className="grid gap-3 lg:grid-cols-2 xl:grid-cols-3">
        {f.shown.map((x, i) => (
          <li key={x.id} className="flex flex-col gap-2 rounded-xl border border-border p-4">
            <p className="type-caption font-semibold text-muted-foreground">Finding {i + 1}</p>
            <h3 className="type-body font-semibold">{x.title}</h3>
            <ul className="list-disc space-y-0.5 pl-5 type-caption">
              {x.evidence.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
            <p className="mt-auto type-caption">
              <span className="font-semibold num">
                {fmtUsd(x.impact[0], 0)}–{fmtUsd(x.impact[1], 0)}
              </span>{" "}
              {x.impactLabel} <ToneBadge tone="neutral">Estimate</ToneBadge>
            </p>
            <Button size="xs" variant="outline" className="self-start" onClick={() => explore(x)}>
              {x.explore.label}
            </Button>
          </li>
        ))}
      </ol>
      {f.hidden.length > 0 && (
        <p className="type-caption text-muted-foreground">
          {f.hidden.length} finding{f.hidden.length === 1 ? "" : "s"} hidden: {f.hidden.map((h) => `${h.title}${h.because.length ? ` (needs ${h.because.join(", ")})` : " (source not connected)"}`).join("; ")}.
        </p>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={launch} disabled={tour?.status === "running" || tour?.status === "paused"} data-tour="launch-first">
          <Play aria-hidden="true" />
          Launch your first experiment
        </Button>
        <span className="type-caption text-muted-foreground">The agent drives the Workbench in a sandbox and asks before anything goes live.</span>
      </div>
    </section>
  );
}

function JourneyAnalytics() {
  const { t } = useWb();
  const tel = t.growth.telemetry;
  const sessions = new Set(tel.filter((e) => e.kind === "tour" && e.name === "tour.start").map((e) => e.session));
  const reached = TOUR_STEPS.map((s) => ({ s, n: new Set(tel.filter((e) => e.kind === "tour" && (e.name === `step.${s.id}` || (s.id === "launch" && e.name === "tour.launch"))).map((e) => e.session)).size, took: tel.filter((e) => e.kind === "tour" && e.name === `step.${s.id}` && e.detail === "taken over").length }));
  const recent = tel.filter((e) => ["consent", "connector", "lane", "question", "card", "reveal", "tour", "experiment"].includes(e.kind)).slice(0, 14);
  return (
    <Collapsible>
      <CollapsibleTrigger asChild>
        <Button size="sm" variant="ghost" className="h-auto py-1.5 text-left whitespace-normal">
          <Check aria-hidden="true" />
          Journey analytics: Time to first experiment and drop-off by step
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent className="mt-2 grid gap-4 lg:grid-cols-2">
        <section aria-labelledby="drop-h" className="rounded-xl border border-border bg-card p-4">
          <h3 id="drop-h" className="type-caption font-semibold uppercase tracking-wide text-muted-foreground">
            Tour sessions reaching each step ({sessions.size} started)
          </h3>
          <ol className="mt-2 space-y-1">
            {reached.map(({ s, n, took }) => (
              <li key={s.id} className="grid grid-cols-[minmax(0,1fr)_120px_auto] items-center gap-2 type-caption">
                <span className="truncate">{s.title}</span>
                <span aria-hidden="true" className="h-2 overflow-hidden rounded-full bg-muted">
                  <span className="block h-full rounded-full bg-info" style={{ width: `${sessions.size ? (n / sessions.size) * 100 : 0}%` }} />
                </span>
                <span className="num">
                  {n}
                  {took ? ` · ${took} by you` : ""}
                </span>
              </li>
            ))}
          </ol>
        </section>
        <section aria-labelledby="ev-h" className="rounded-xl border border-border bg-card p-4">
          <h3 id="ev-h" className="type-caption font-semibold uppercase tracking-wide text-muted-foreground">
            Latest events
          </h3>
          <ol className="mt-2 space-y-1">
            {recent.map((e) => (
              <li key={e.id} className="flex gap-2 type-caption">
                <span className="w-12 shrink-0 num text-muted-foreground">{e.sim != null ? clock(e.sim) : "—"}</span>
                <span className="font-mono">{e.name}</span>
                <span className="truncate text-muted-foreground">{e.detail}</span>
              </li>
            ))}
          </ol>
        </section>
      </CollapsibleContent>
    </Collapsible>
  );
}
