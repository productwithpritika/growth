// The Ask CB drawer, reachable from every screen: Ask CB for Nia and Sam (merchant scope,
// sandboxed while the tour runs), the Credits assistant for Maya, Dev and a Member.
import { useNavigate } from "react-router-dom";
import { MessagesSquare, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import type { TenantState } from "@/core/types";
import { useCockpit, useTenant } from "@/lib/cockpit-store";
import { accountOfPersona, memberPersona, personaById } from "@/tenants/personas";
import { sandboxView, tourActive, tourOf, writeSandbox } from "@/surfaces/workbench/scope";
import { AskThread } from "@/surfaces/ask/thread";
import { LIBRARY } from "@/agents/cb/engine";
import { enabledAt } from "@/ui/horizon";
import type { WorkbenchTab } from "@/tenants/schema";

function liveTenant(): TenantState {
  const s = useCockpit.getState();
  return s.data.tenants[s.data.activeTenant] ?? Object.values(s.data.tenants)[0];
}

export function AskDrawer() {
  const open = useCockpit((s) => s.askOpen);
  const persona = useCockpit((s) => s.persona);
  const horizon = useCockpit((s) => s.horizon);
  const threadId = useCockpit((s) => s.askThreadId);
  const prompt = useCockpit((s) => s.askPrompt);
  const setUi = useCockpit((s) => s.setUi);
  const apply = useCockpit((s) => s.apply);
  const live = useTenant();
  const navigate = useNavigate();
  const p = personaById(persona);
  const merchant = p.surface === "workbench";
  const sandbox = merchant && tourActive(live, persona);
  const t = sandbox ? sandboxView(live, persona) : live;
  const account = merchant ? null : accountOfPersona(p.id);
  const member = p.id === "member" ? memberPersona(t.pack).id : null;
  const tid = threadId ?? (sandbox ? tourOf(live, persona).threadId : null);

  const run = (fn: (s: TenantState) => TenantState, okText: string, opts?: { quiet?: boolean }) => {
    const saved = apply((s) => (merchant && tourActive(s, persona) ? writeSandbox(s, persona, fn) : fn(s)));
    if (!opts?.quiet && okText) {
      if (saved) toast.success(okText);
      else toast.error(`${okText} Not saved in this browser.`);
    }
    return saved;
  };

  const title = merchant ? "Ask CB" : `${t.pack.company} Credits assistant`;
  return (
    <Sheet open={open} onOpenChange={(o) => setUi({ askOpen: o })}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-xl" data-tour="ask-drawer">
        <SheetHeader className="border-b border-border">
          <SheetTitle className="flex items-center gap-2">
            <Sparkles aria-hidden="true" className="size-4 text-primary" />
            {title}
            {sandbox && <span className="rounded-full bg-info-soft px-2 py-0.5 text-xs font-medium text-info-ink">Tour sandbox</span>}
          </SheetTitle>
          <SheetDescription>
            {merchant ? "Answers come from the cockpit's data, show their evidence, and never change anything without your approval." : "I can only see your own workspace."}
          </SheetDescription>
        </SheetHeader>
        <div className="min-h-0 flex-1">
          <AskThread
            key={`${persona}-${t.packId}-${sandbox ? "sb" : "live"}`}
            scope={merchant ? "merchant" : "enduser"}
            persona={merchant ? persona : p.id}
            account={account}
            member={member}
            t={t}
            getT={() => {
              const l = liveTenant();
              return merchant && tourActive(l, persona) ? sandboxView(l, persona) : l;
            }}
            run={run}
            sandbox={sandbox}
            horizon={horizon}
            threadId={tid}
            onThread={(id) => setUi({ askThreadId: id })}
            onTab={(tab) => {
              setUi({ wbTab: tab as WorkbenchTab, askOpen: false });
              navigate("/");
            }}
            incoming={prompt}
            compact
            starters={LIBRARY.filter((l) => l.scope === (merchant ? "merchant" : "enduser")).slice(0, 4).map((l) => l.prompt)}
          />
        </div>
      </SheetContent>
    </Sheet>
  );
}

export function AskLauncher({ className }: { className?: string }) {
  const persona = useCockpit((s) => s.persona);
  const horizon = useCockpit((s) => s.horizon);
  const setUi = useCockpit((s) => s.setUi);
  const merchant = personaById(persona).surface === "workbench";
  if (merchant ? !enabledAt(horizon, "wb.ask") : !enabledAt(horizon, "hub.assistant")) return null;
  return (
    <Button size="sm" variant="ghost" className={className} onClick={() => setUi({ askOpen: true })} aria-label={merchant ? "Open Ask CB" : "Open the Credits assistant"} data-tour="ask-launcher">
      <MessagesSquare aria-hidden="true" />
      <span className="hidden md:inline">{merchant ? "Ask CB" : "Assistant"}</span>
    </Button>
  );
}
