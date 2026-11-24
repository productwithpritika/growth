// Presenter mode (Phase 8 §8.7): an overlay with shortcuts to switch persona, tenant and Horizon,
// jump to named moments, fast-forward the Time machine, reset, a 12-minute timer, a pseudo-locale
// switch, and the pitch mapping (§8.8) from each presentation question to where it is shown.
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp, FastForward, MonitorPlay, Pause, Play, RotateCcw, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { useAppShortcut } from "@/components/shortcut-provider";
import { useConfirm } from "@/hooks/use-confirm";
import { useCockpit, useTenantList, type HubTab, type Horizon } from "@/lib/cockpit-store";
import type { WorkbenchTab } from "@/tenants/schema";
import type { PersonaId } from "@/tenants/personas";
import { advanceDay } from "@/sim/seed";
import { cn } from "@/lib/utils";

export interface NamedMoment {
  id: string;
  label: string;
  minute: number;
  persona?: PersonaId;
  hubTab?: HubTab;
  wbTab?: WorkbenchTab;
  wbSub?: string;
  path?: "/" | "/roadmap" | "/portfolio" | "/health" | "/trust";
  note: string;
}

/** The 12-minute demo, in order. Minutes are where each moment should start. */
export const MOMENTS: NamedMoment[] = [
  { id: "roadmap", label: "Roadmap: what ships first and why", minute: 0, path: "/roadmap", note: "Open on the release rail: three cadences, maturity flags tied to the Horizon toggle." },
  { id: "hub-dev", label: "Credits Hub: Dev is running low", minute: 1, persona: "dev", hubTab: "home", note: "Forecast, moments and top-ups for a paying team." },
  { id: "hub-maya", label: "Credits Hub: Maya on Free", minute: 2.5, persona: "maya", hubTab: "home", note: "Activation and the upgrade moment for a free user." },
  { id: "onboarding", label: "Agentic onboarding and tour", minute: 3.5, persona: "nia", wbTab: "start", note: "Connect, ingest, reveal; the tour drafts a first experiment." },
  { id: "ask", label: "Ask CB", minute: 4.5, persona: "nia", wbTab: "ask", note: "Ask why quiet free users leave; draft the experiment it recommends." },
  { id: "stoploss", label: "Experiment lab and stop-loss", minute: 5.5, persona: "nia", wbTab: "experiments", note: "Fast-forward one day: the 40% win-back pauses itself on margin." },
  { id: "rightsizing", label: "Evals: model right-sizing", minute: 6.5, persona: "nia", wbTab: "evals", wbSub: "rightsizing", note: "Company research: 92 vs 91 at 38% of the cost. Slide the scenario, create the experiment." },
  { id: "gate", label: "Evals: the quality gate", minute: 7.5, persona: "nia", wbTab: "evals", wbSub: "gate", note: "Find work email fails on the cheaper model; overrides need a reason and an approver." },
  { id: "mcp", label: "MCP Console and constraints", minute: 8.25, persona: "nia", wbTab: "mcp", wbSub: "tools", note: "grant_reward max 50: an agent sending 80 is refused." },
  { id: "external", label: "External agent", minute: 9, persona: "nia", wbTab: "mcp", wbSub: "external", note: "get_balance then estimate_run_cost; set_auto_topup goes to approval." },
  { id: "agents", label: "Agents and the kill switch", minute: 9.75, persona: "nia", wbTab: "agents", note: "Run the Experiment Operator; flip the global kill switch." },
  { id: "experience", label: "Custom portal experience", minute: 10.5, persona: "nia", wbTab: "experiences", note: "Plain words to a Moment, preview, publish, roll back." },
  { id: "embed", label: "Embed SDK", minute: 11.25, persona: "nia", wbTab: "embed", note: "The hub inside the tenant's own app, drawer or modal." },
  { id: "health", label: "Product health and close", minute: 11.75, path: "/health", note: "North star and guardrails; end on the portfolio." },
];

export const PITCH: { q: string; where: string; moment: string }[] = [
  { q: "How is the portfolio managed, what ships first, later, why", where: "Roadmap and Portfolio view", moment: "roadmap" },
  { q: "How does the portal support credit pricing and monetization moments", where: "Credits Hub, Moments, Plan Fit, Top-ups", moment: "hub-dev" },
  { q: "How is a free user activated and converted", where: "Lifecycle lens, Rewards, experiments", moment: "hub-maya" },
  { q: "What MCP tooling is supported, especially for custom experiences", where: "MCP Console, Portal Experience tools, Moment definitions", moment: "mcp" },
  { q: "How are agent workflows incorporated", where: "Agents page, Ask CB, Agentic tour, approvals", moment: "agents" },
];

export function useJump() {
  const navigate = useNavigate();
  const setPersona = useCockpit((s) => s.setPersona);
  const setUi = useCockpit((s) => s.setUi);
  return (id: string) => {
    const m = MOMENTS.find((x) => x.id === id);
    if (!m) return;
    if (m.persona) setPersona(m.persona);
    setUi({ ...(m.hubTab ? { hubTab: m.hubTab } : {}), ...(m.wbTab ? { wbTab: m.wbTab } : {}), wbSub: m.wbSub ?? null });
    navigate(m.path ?? "/");
  };
}

export function PresenterButton({ className }: { className?: string }) {
  const open = useCockpit((s) => s.presenter);
  const setUi = useCockpit((s) => s.setUi);
  return (
    <Button size="sm" variant="ghost" className={className} aria-pressed={open} onClick={() => setUi({ presenter: !open })} aria-label="Presenter mode (Alt+Shift+P)">
      <MonitorPlay aria-hidden="true" />
      <span className="hidden 2xl:inline">Present</span>
    </Button>
  );
}

const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

export function PresenterOverlay() {
  const open = useCockpit((s) => s.presenter);
  const setUi = useCockpit((s) => s.setUi);
  const persona = useCockpit((s) => s.persona);
  const setPersona = useCockpit((s) => s.setPersona);
  const horizon = useCockpit((s) => s.horizon);
  const pseudo = useCockpit((s) => s.pseudo);
  const active = useCockpit((s) => s.data.activeTenant);
  const setTenant = useCockpit((s) => s.setTenant);
  const apply = useCockpit((s) => s.apply);
  const resetDemo = useCockpit((s) => s.resetDemo);
  const tenants = useTenantList();
  const jump = useJump();
  const confirm = useConfirm();
  const navigate = useNavigate();
  const [idx, setIdx] = useState(-1);
  const [small, setSmall] = useState(false);
  const [started, setStarted] = useState<number | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [now, setNow] = useState(0);
  useEffect(() => {
    if (started == null) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [started]);
  const secs = elapsed + (started != null && now ? Math.max(0, (now - started) / 1000) : 0);
  const go = (i: number) => {
    const k = Math.max(0, Math.min(MOMENTS.length - 1, i));
    setIdx(k);
    jump(MOMENTS[k].id);
  };
  const ff = (n: number) => {
    const ok = apply((s) => {
      let x = s;
      for (let i = 0; i < n; i++) x = advanceDay(x);
      return x;
    });
    (ok ? toast.success : toast.error)(`Moved ${n} simulated day${n === 1 ? "" : "s"} forward.`);
  };
  useAppShortcut("alt+shift+p", () => setUi({ presenter: !open }));
  useAppShortcut("alt+shift+n", () => go(idx + 1));
  useAppShortcut("alt+shift+b", () => go(idx - 1));
  useAppShortcut("alt+shift+f", () => ff(1));
  useAppShortcut("alt+shift+l", () => setUi({ pseudo: !pseudo }));
  if (!open) return null;
  const segment = [...MOMENTS].reverse().find((m) => secs / 60 >= m.minute);
  const cur = idx >= 0 ? MOMENTS[idx] : null;
  return (
    <aside aria-label="Presenter mode" className="fixed inset-x-2 bottom-2 z-50 max-h-[70dvh] overflow-y-auto rounded-xl border border-zinc-700 bg-zinc-950 p-3 text-zinc-50 shadow-2xl sm:inset-x-auto sm:right-4 sm:bottom-4 sm:w-[380px]">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">Presenter mode</h2>
        <div className="flex items-center gap-1">
          <span className="num rounded bg-zinc-800 px-2 py-0.5 text-xs" aria-live="off">
            {mmss(secs)} / 12:00
          </span>
          <Button size="icon-sm" variant="ghost" className="text-zinc-200 hover:bg-zinc-800 hover:text-white" aria-label={started != null ? "Pause the timer" : "Start the timer"} onClick={() => {
            if (started != null) {
              setElapsed(secs);
              setStarted(null);
            } else {
              setNow(Date.now());
              setStarted(Date.now());
            }
          }}>
            {started != null ? <Pause aria-hidden="true" /> : <Play aria-hidden="true" />}
          </Button>
          <Button size="icon-sm" variant="ghost" className="text-zinc-200 hover:bg-zinc-800 hover:text-white" aria-label={small ? "Expand presenter mode" : "Minimise presenter mode"} aria-expanded={!small} onClick={() => setSmall(!small)}>
            {small ? <ChevronUp aria-hidden="true" /> : <ChevronDown aria-hidden="true" />}
          </Button>
          <Button size="icon-sm" variant="ghost" className="text-zinc-200 hover:bg-zinc-800 hover:text-white" aria-label="Close presenter mode" onClick={() => setUi({ presenter: false })}>
            <X aria-hidden="true" />
          </Button>
        </div>
      </div>
      {segment && started != null && <p className="mt-1 text-xs text-zinc-300">Now: {segment.label}</p>}
      {small ? (
        <div className="mt-2 flex items-center gap-1.5">
          <Button size="icon-sm" variant="ghost" className="text-zinc-200 hover:bg-zinc-800 hover:text-white" aria-label="Previous moment" onClick={() => go(idx - 1)}>
            <ChevronLeft aria-hidden="true" />
          </Button>
          <span className="min-w-0 flex-1 truncate text-xs">{cur ? cur.label : "Pick a moment"}</span>
          <Button size="icon-sm" variant="ghost" className="text-zinc-200 hover:bg-zinc-800 hover:text-white" aria-label="Next moment" onClick={() => go(idx + 1)}>
            <ChevronRight aria-hidden="true" />
          </Button>
        </div>
      ) : (
      <>
      <div className="mt-3 grid grid-cols-3 gap-2">
        <div className="space-y-1">
          <Label htmlFor="pr-persona" className="text-xs text-zinc-300">Persona</Label>
          <NativeSelect id="pr-persona" size="sm" className="border-zinc-700 bg-zinc-900 text-zinc-50" value={persona} onChange={(e) => { setPersona(e.target.value as PersonaId); navigate("/"); }}>
            {(["maya", "dev", "member", "nia", "sam"] as PersonaId[]).map((p) => (
              <NativeSelectOption key={p} value={p}>
                {p === "member" ? "Member" : p.charAt(0).toUpperCase() + p.slice(1)}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </div>
        <div className="space-y-1">
          <Label htmlFor="pr-tenant" className="text-xs text-zinc-300">Tenant</Label>
          <NativeSelect id="pr-tenant" size="sm" className="border-zinc-700 bg-zinc-900 text-zinc-50" value={active} onChange={(e) => setTenant(e.target.value)}>
            {tenants.map((x) => (
              <NativeSelectOption key={x.id} value={x.id}>
                {x.company}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </div>
        <div className="space-y-1">
          <Label htmlFor="pr-h" className="text-xs text-zinc-300">Horizon</Label>
          <NativeSelect id="pr-h" size="sm" className="border-zinc-700 bg-zinc-900 text-zinc-50" value={horizon} onChange={(e) => setUi({ horizon: e.target.value as Horizon })}>
            <NativeSelectOption value="crawl">Crawl</NativeSelectOption>
            <NativeSelectOption value="walk">Walk</NativeSelectOption>
            <NativeSelectOption value="run">Run</NativeSelectOption>
          </NativeSelect>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        {[1, 3, 7].map((n) => (
          <Button key={n} size="xs" variant="outline" className="border-zinc-700 bg-transparent text-zinc-100 hover:bg-zinc-800" onClick={() => ff(n)} aria-label={`Fast-forward ${n} simulated day${n === 1 ? "" : "s"}`}>
            <FastForward aria-hidden="true" />+{n}d
          </Button>
        ))}
        <Button
          size="xs"
          variant="outline"
          className="border-zinc-700 bg-transparent text-zinc-100 hover:bg-zinc-800"
          onClick={async () => {
            if (await confirm({ title: "Reset the demo?", description: "Everything goes back to the seeded state, dated today.", confirmLabel: "Reset", destructive: true })) {
              resetDemo();
              setIdx(-1);
            }
          }}
        >
          <RotateCcw aria-hidden="true" />
          Reset
        </Button>
        <div className="ml-auto flex items-center gap-1.5">
          <Switch id="pr-pseudo" checked={pseudo} onCheckedChange={(v) => setUi({ pseudo: v })} />
          <Label htmlFor="pr-pseudo" className="text-xs text-zinc-300">Pseudo-locale</Label>
        </div>
      </div>
      <div className="mt-3 space-y-1">
        <div className="flex items-center justify-between text-xs text-zinc-300">
          <span>Moments</span>
          <span>Alt+Shift+N next · B back · F +1 day</span>
        </div>
        <ol className="space-y-0.5">
          {MOMENTS.map((m, i) => (
            <li key={m.id}>
              <button type="button" onClick={() => go(i)} aria-current={idx === i ? "step" : undefined} className={cn("flex w-full items-baseline gap-2 rounded px-2 py-1 text-left text-xs focus-visible:outline-2 focus-visible:outline-white", idx === i ? "bg-zinc-100 text-zinc-950" : "text-zinc-200 hover:bg-zinc-800")}>
                <span className="num w-9 shrink-0 opacity-70">{mmss(m.minute * 60)}</span>
                <span>{m.label}</span>
              </button>
            </li>
          ))}
        </ol>
        {cur && <p className="rounded bg-zinc-900 px-2 py-1.5 text-xs text-zinc-200">Notes: {cur.note}</p>}
      </div>
      <details className="mt-3 text-xs">
        <summary className="cursor-pointer text-zinc-300">Pitch mapping</summary>
        <ul className="mt-1 space-y-1">
          {PITCH.map((p) => (
            <li key={p.q} className="flex items-start justify-between gap-2">
              <span>
                <span className="font-medium">{p.q}</span>
                <span className="block text-zinc-400">{p.where}</span>
              </span>
              <Button size="xs" variant="outline" className="shrink-0 border-zinc-700 bg-transparent text-zinc-100 hover:bg-zinc-800" onClick={() => go(MOMENTS.findIndex((m) => m.id === p.moment))}>
                Go
              </Button>
            </li>
          ))}
        </ul>
      </details>
      </>
      )}
    </aside>
  );
}
