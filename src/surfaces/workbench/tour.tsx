// The agentic tour dock (Phase 3 §3.5): the agent drives the real Workbench in a sandbox copy
// and narrates; you can pause, take over at any step, skip to Ask CB, replay, hear the
// narration and turn motion down. The launch is the only live write and needs your tap.
import { useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronUp, Hand, LogOut, Pause, Play, RotateCcw, SkipForward, Volume2, VolumeX } from "lucide-react";
import { toast } from "sonner";
import type { TenantState } from "@/core/types";
import type { TourState } from "@/growth/types";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { AgentNarrator, type NarratorStep } from "@/ui/agent-narrator";
import { ApprovalSheet } from "@/ui/approval-sheet";
import { LabScorecard } from "@/ui/lab-scorecard";
import { useCockpit } from "@/lib/cockpit-store";
import { useAppShortcut } from "@/components/shortcut-provider";
import { sandboxView, useWb } from "@/surfaces/workbench/scope";
import { completeStep, draftFromPick, exitTour, launchFromTour, setTour, startTour, TOUR_STEPS, ttfe } from "@/growth/tour";
import { hypothesesFor } from "@/growth/ideas";
import { newThread } from "@/agents/cb/engine";
import { clock } from "@/growth/onboarding";
import { speak, stopSpeaking } from "@/surfaces/ask/voice";
import { personaName, type PersonaId } from "@/tenants/personas";
import { fmtNum } from "@/core/format";
import { cn } from "@/lib/utils";

type Ui = { wbTab: string; segment: string; askOpen: boolean };

function satisfied(id: string, t: TenantState, tour: TourState, ui: Ui): boolean {
  const threads = t.growth.ask.threads;
  switch (id) {
    case "open-cohorts":
      return ui.wbTab === "overview";
    case "select-cohort":
      return ui.segment === "free-quiet";
    case "ask-why":
      return threads.some((th) => th.messages.some((m) => m.role === "user"));
    case "hypotheses":
      return threads.some((th) => th.messages.some((m) => m.blocks?.some((b) => b.kind === "hypotheses")));
    case "pick":
      return !!tour.picked;
    case "draft":
      return !!tour.draftId && t.growth.lab.some((e) => e.id === tour.draftId);
    case "scorecard":
      return tour.previewed;
    case "approval":
      return tour.approvalOpen;
    case "launch":
      return !!tour.launchedId;
    default:
      return false;
  }
}

const TARGET: Record<string, string> = {
  "open-cohorts": "nav-overview",
  "select-cohort": "segment-free-quiet",
  "ask-why": "ask-launcher",
  hypotheses: "ask-drawer",
  pick: "hyp-pick",
  draft: "lab-draft",
  scorecard: "scorecard-preview",
  approval: "request-approval",
};

export function TourDock() {
  const { live, persona } = useWb();
  const apply = useCockpit((s) => s.apply);
  const setUi = useCockpit((s) => s.setUi);
  const wbTab = useCockpit((s) => s.wbTab);
  const segment = useCockpit((s) => s.segment);
  const askOpen = useCockpit((s) => s.askOpen);
  const tour = live.growth.tours[persona];
  const active = !!tour && (tour.status === "running" || tour.status === "paused");
  const t = sandboxView(live, persona);
  const [collapsed, setCollapsed] = useState(false);
  const [live2, setLive2] = useState("");
  const acted = useRef<Record<string, boolean>>({});
  const spoken = useRef<string>("");
  const owner = personaName(live.pack, persona as PersonaId);
  const reduced = (tour?.reducedMotion ?? false) || (typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches);
  const step = active ? TOUR_STEPS[tour.step] : null;
  const ui: Ui = { wbTab, segment, askOpen };

  const write = (fn: (s: TenantState) => TenantState) =>
    apply((s) => {
      const tr = s.growth.tours[persona];
      if (!tr?.sandbox) return fn(s);
      const view = sandboxView(s, persona);
      const next = fn(view);
      const nt = next.growth.tours[persona];
      return { ...s, growth: { ...s.growth, telemetry: next.growth.telemetry, tours: { ...s.growth.tours, [persona]: { ...nt, sandbox: nt.sandbox ? { lab: next.growth.lab, threads: next.growth.ask.threads, audiences: next.growth.audiences } : null } } } };
    });

  // Advance when the current step's condition holds, whoever made it true.
  useEffect(() => {
    if (!active || !step || !tour) return;
    if (tour.completed.some((c) => c.id === step.id)) return;
    if (satisfied(step.id, t, tour, ui)) {
      const agentDid = acted.current[`${tour.sessionId}:${step.id}`] || (step.id === "hypotheses" && acted.current[`${tour.sessionId}:ask-why`]);
      const by = agentDid ? "agent" : "you";
      write((s) => completeStep(s, persona, by));
    }
  });

  // Narrate each new step (aloud when voice is on).
  useEffect(() => {
    if (!active || !step || !tour) return;
    const key = `${tour.sessionId}:${step.id}`;
    if (spoken.current === key) return;
    spoken.current = key;
    const text = tour.control === "you" ? `Your turn: ${step.you}` : step.narrate(t);
    setLive2(text);
    if (tour.voice) speak(text);
  });

  // The agent acts after a short narration pause, unless paused or you have control. Keyed on the
  // step so re-renders (the highlight, the clock) don't keep resetting the timer.
  const latest = useRef({ t, tour, ui });
  useEffect(() => {
    latest.current = { t, tour, ui };
  });
  const agentRef = useRef<(id: string) => void>(() => undefined);
  useEffect(() => {
    agentRef.current = agent;
  });
  const stepKey = active && step && tour && tour.status === "running" && tour.control === "agent" ? `${tour.sessionId}:${step.id}` : null;
  useEffect(() => {
    if (!stepKey) return;
    const id = window.setTimeout(
      () => {
        const L = latest.current;
        const stepId = stepKey.split(":").pop()!;
        if (acted.current[stepKey] || !L.tour || satisfied(stepId, L.t, L.tour, L.ui)) return;
        acted.current[stepKey] = true;
        agentRef.current(stepId);
      },
      reduced ? 500 : 1700,
    );
    return () => window.clearTimeout(id);
  }, [stepKey, reduced]);

  // Highlight the element the step is about.
  const [box, setBox] = useState<DOMRect | null>(null);
  const target = !active || !step ? null : step.id === "pick" ? `hyp-${tour?.picked ?? hypothesesFor(t, "free-quiet", t.clock.slice(0, 10))[0]?.id}` : (TARGET[step.id] ?? null);
  useEffect(() => {
    if (!target) {
      setBox(null);
      return;
    }
    let first = true;
    const find = () => {
      const el = document.querySelector<HTMLElement>(`[data-tour="${target}"]`);
      if (!el || el.offsetParent === null) {
        setBox(null);
        return;
      }
      if (first) {
        el.scrollIntoView({ block: "center", behavior: reduced ? "auto" : "smooth" });
        first = false;
      }
      const r = el.getBoundingClientRect();
      setBox((b) => (b && Math.abs(b.top - r.top) < 1 && Math.abs(b.left - r.left) < 1 && Math.abs(b.width - r.width) < 1 && Math.abs(b.height - r.height) < 1 ? b : r));
    };
    find();
    const id = window.setInterval(find, 400);
    return () => window.clearInterval(id);
  }, [target, reduced]);

  // Keyboard: Alt+P pause, Alt+T take over, Alt+S skip to Ask CB, Alt+R replay, Alt+X exit.
  useAppShortcut("alt+p", () => active && togglePause());
  useAppShortcut("alt+t", () => active && toggleControl());
  useAppShortcut("alt+s", () => active && skip());
  useAppShortcut("alt+r", () => active && replay());
  useAppShortcut("alt+x", () => active && exit());

  function agent(id: string) {
    const s = t;
    switch (id) {
      case "open-cohorts":
        setUi({ wbTab: "overview", askOpen: false });
        break;
      case "select-cohort":
        setUi({ segment: "free-quiet" });
        break;
      case "ask-why": {
        const th = newThread("merchant", persona, s.clock, true);
        write((x) => setTour({ ...x, growth: { ...x.growth, ask: { ...x.growth.ask, threads: [th, ...x.growth.ask.threads] } } }, persona, { threadId: th.id }));
        setUi({ askOpen: true, askThreadId: th.id, askPrompt: { text: "Why do quiet free users leave?", via: "tour", n: Date.now() } });
        break;
      }
      case "hypotheses":
        setUi({ askOpen: true });
        break;
      case "pick": {
        const h = hypothesesFor(s, "free-quiet", s.clock.slice(0, 10))[0];
        if (h) write((x) => setTour(x, persona, { picked: h.id }));
        break;
      }
      case "draft": {
        let id2 = "";
        write((x) => {
          const r = draftFromPick(x, persona, owner);
          id2 = r.id;
          return setTour(r.t, persona, { draftId: r.id });
        });
        setUi({ wbTab: "experiments", wbExperiment: id2 || null, askOpen: false });
        break;
      }
      case "scorecard":
        write((x) => setTour(x, persona, { previewed: true }));
        setUi({ wbTab: "experiments", wbExperiment: tour?.draftId ?? null });
        break;
      case "approval":
        write((x) => setTour(x, persona, { approvalOpen: true }));
        break;
    }
  }

  function togglePause() {
    if (!tour) return;
    write((x) => setTour(x, persona, { status: tour.status === "paused" ? "running" : "paused" }));
    stopSpeaking();
  }
  function toggleControl() {
    if (!tour) return;
    write((x) => setTour(x, persona, { control: tour.control === "agent" ? "you" : "agent" }));
    spoken.current = "";
  }
  function skip() {
    if (!tour) return;
    write((x) => {
      let n = x;
      if (!n.growth.tours[persona].completed.some((c) => c.id === "open-cohorts")) n = completeStep(n, persona, "agent");
      if (!n.growth.tours[persona].completed.some((c) => c.id === "select-cohort")) n = completeStep(n, persona, "agent");
      return n;
    });
    setUi({ segment: "free-quiet" });
  }
  function replay() {
    acted.current = {};
    spoken.current = "";
    apply((s) => startTour(s, persona));
    setUi({ wbTab: "start", segment: "", askOpen: false, askThreadId: null });
  }
  function exit() {
    stopSpeaking();
    apply((s) => exitTour(s, persona));
    setUi({ askOpen: false, askThreadId: null });
  }

  const approve = () => {
    let id: string | null = null;
    apply((s) => {
      const r = launchFromTour(s, persona, owner);
      id = r.id;
      return r.t;
    });
    stopSpeaking();
    setUi({ askOpen: false, askThreadId: null, wbTab: "experiments", wbExperiment: id });
    toast.success("Launched. This is the only live change the tour made.");
  };

  if (!tour) return null;
  if (!active && !(tour.status === "done" && tour.launchedId)) return null;
  const draft = t.growth.lab.find((e) => e.id === tour.draftId);
  const steps: NarratorStep[] = TOUR_STEPS.map((s, i) => {
    const done = tour.completed.find((c) => c.id === s.id);
    return { id: s.id, label: s.title, status: done ? "done" : i === tour.step && active ? "running" : "pending", by: done ? done.by : undefined, detail: i === tour.step && active ? (tour.control === "you" ? `Your turn: ${s.you}` : s.narrate(t)) : undefined };
  });
  const time = clock(ttfe(live.growth.onboarding));

  return (
    <>
      {box && active && target && (
        <div
          aria-hidden="true"
          className={cn("pointer-events-none fixed z-[60] rounded-lg ring-4 ring-primary/70", !reduced && "transition-all duration-300")}
          style={{ top: box.top - 4, left: box.left - 4, width: box.width + 8, height: box.height + 8 }}
        />
      )}
      <aside aria-labelledby="tour-h" className="fixed inset-x-2 bottom-2 z-[55] max-h-[70dvh] overflow-y-auto rounded-xl border border-border bg-popover p-3 shadow-xl sm:inset-x-auto sm:right-4 sm:bottom-4 sm:w-[380px]" data-tour="dock">
        <div className="flex items-center justify-between gap-2">
          <h2 id="tour-h" className="type-heading">
            {tour.status === "done" ? "First experiment launched" : "Agentic tour"}
          </h2>
          <div className="flex items-center gap-1">
            {active && <span className="rounded-full bg-info-soft px-2 py-0.5 text-xs font-medium text-info-ink">Sandbox</span>}
            <Button size="icon-sm" variant="ghost" aria-label={collapsed ? "Expand the tour" : "Collapse the tour"} aria-expanded={!collapsed} onClick={() => setCollapsed((c) => !c)}>
              {collapsed ? <ChevronUp aria-hidden="true" /> : <ChevronDown aria-hidden="true" />}
            </Button>
          </div>
        </div>
        {tour.status === "done" ? (
          <div className="mt-2 space-y-2">
            <p className="type-body">
              {draft?.name ?? "Your experiment"} is live in Experiments. Time to first experiment: <span className="font-semibold num">{time}</span>.
            </p>
            <p className="type-caption text-muted-foreground">
              Steps you took over: {tour.completed.filter((c) => c.by === "you" && c.id !== "launch").length} of {TOUR_STEPS.length - 1}; the launch was your approval. Use the Time machine to read D1, D3 and D7.
            </p>
            <div className="flex gap-2">
              <Button size="sm" onClick={() => setUi({ wbTab: "experiments", wbExperiment: tour.launchedId })}>
                Open the experiment
              </Button>
              <Button size="sm" variant="ghost" onClick={() => apply((s) => setTour(s, persona, { launchedId: null }))}>
                Close
              </Button>
            </div>
          </div>
        ) : (
          !collapsed && (
            <div className="mt-2 space-y-3">
              <p className="type-caption text-muted-foreground">
                Step {tour.step + 1} of {TOUR_STEPS.length} · {tour.control === "you" ? "You have control" : tour.status === "paused" ? "Paused" : "Agent driving"} · {time} since Connect
              </p>
              <AgentNarrator steps={steps} running={tour.status === "running"} takenOver={tour.control === "you"} canUndo={false} live={live2} />
              <div className="flex flex-wrap gap-1.5">
                <Button size="xs" variant="outline" onClick={togglePause} aria-keyshortcuts="Alt+P">
                  {tour.status === "paused" ? <Play aria-hidden="true" /> : <Pause aria-hidden="true" />}
                  {tour.status === "paused" ? "Resume" : "Pause"}
                </Button>
                <Button size="xs" variant="outline" onClick={toggleControl} aria-keyshortcuts="Alt+T">
                  <Hand aria-hidden="true" />
                  {tour.control === "you" ? "Hand back to agent" : "Take over"}
                </Button>
                <Button size="xs" variant="outline" onClick={skip} disabled={tour.step >= 2} aria-keyshortcuts="Alt+S">
                  <SkipForward aria-hidden="true" />
                  Skip to Ask CB
                </Button>
                <Button size="xs" variant="ghost" onClick={replay} aria-keyshortcuts="Alt+R">
                  <RotateCcw aria-hidden="true" />
                  Replay
                </Button>
                <Button size="xs" variant="ghost" onClick={exit} aria-keyshortcuts="Alt+X">
                  <LogOut aria-hidden="true" />
                  Exit
                </Button>
              </div>
              <div className="flex flex-wrap gap-4">
                <span className="flex items-center gap-1.5">
                  <Switch
                    id="tour-voice"
                    checked={tour.voice}
                    onCheckedChange={(v) => {
                      if (!v) stopSpeaking();
                      write((x) => setTour(x, persona, { voice: v }));
                    }}
                  />
                  <Label htmlFor="tour-voice" className="flex items-center gap-1 type-caption font-normal">
                    {tour.voice ? <Volume2 aria-hidden="true" className="size-3.5" /> : <VolumeX aria-hidden="true" className="size-3.5" />}
                    Voice narration
                  </Label>
                </span>
                <span className="flex items-center gap-1.5">
                  <Switch id="tour-motion" checked={tour.reducedMotion} onCheckedChange={(v) => write((x) => setTour(x, persona, { reducedMotion: v }))} />
                  <Label htmlFor="tour-motion" className="type-caption font-normal">
                    Reduced motion
                  </Label>
                </span>
              </div>
              <p className="type-caption text-muted-foreground">Keys: Alt+P pause · Alt+T take over · Alt+S skip · Alt+R replay · Alt+X exit</p>
            </div>
          )
        )}
      </aside>
      {active && tour.approvalOpen && draft && (
        <ApprovalSheet
          open
          onOpenChange={(o) => !o && write((x) => setTour(x, persona, { approvalOpen: false }))}
          title={`Launch "${draft.name}"`}
          description="The agent drafted this in the sandbox. Approving copies it to your live Workbench and starts it. Nothing else from the tour goes live."
          preview={
            <div className="space-y-2 type-caption">
              <p>{draft.hypothesis}</p>
              <p>
                Audience {draft.audience.label} ({fmtNum(draft.audience.size)}), {Math.round(draft.allocation * 100)}% allocated, {Math.round(draft.holdout * 100)}% holdout, layer {draft.layer}. Variant: {draft.intervention.variant}.
              </p>
              <LabScorecard e={draft} preview />
            </div>
          }
          diff={[
            { path: "experiments", before: "", after: `${draft.name} · running` },
            { path: "audience", before: "", after: `${draft.audience.label} · ${fmtNum(draft.audience.size)}` },
            { path: "guardrails", before: "", after: draft.guardrails.map((g) => g.label).join(", ") },
          ]}
          risk={{ level: "low", reasons: ["Holdout and stop-loss on every guardrail.", "No pricing or plan changes: the variant is a reward rule for one cohort.", "Voice can't approve; this needs your tap."] }}
          auditId={`pending · ${draft.id}`}
          onApprove={approve}
          onReject={() => {
            write((x) => setTour(x, persona, { approvalOpen: false }));
            toast("Not launched. The draft stays in the sandbox.");
          }}
          approveLabel="Approve and launch"
        />
      )}
    </>
  );
}
