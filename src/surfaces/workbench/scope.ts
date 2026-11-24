// Where Workbench writes go. Normally to the live tenant; while the agentic tour runs for the
// current persona, to a sandbox copy whose experiments, Ask CB threads and audiences live on the
// tour itself. A sandbox write can change nothing else: the pack, ledger, Hub accounts and CB
// credits always come from the live state.
import { useMemo } from "react";
import { toast } from "sonner";
import type { TenantState } from "@/core/types";
import { useCockpit, useTenant } from "@/lib/cockpit-store";
import { sandboxView, tourActive, writeSandbox } from "@/growth/sandbox";

export { sandboxView, tourActive, tourOf, writeSandbox } from "@/growth/sandbox";

export type WbRun = (fn: (s: TenantState) => TenantState, okText: string, opts?: { quiet?: boolean }) => boolean;

export function useWb(): { t: TenantState; live: TenantState; run: WbRun; sandbox: boolean; persona: string } {
  const live = useTenant();
  const persona = useCockpit((s) => s.persona);
  const apply = useCockpit((s) => s.apply);
  const sandbox = tourActive(live, persona);
  const t = useMemo(() => (sandbox ? sandboxView(live, persona) : live), [live, persona, sandbox]);
  const run: WbRun = (fn, okText, opts) => {
    const saved = apply((s) => (tourActive(s, persona) ? writeSandbox(s, persona, fn) : fn(s)));
    if (!opts?.quiet && okText) {
      const text = saved ? okText : `${okText} Not saved in this browser.`;
      if (saved) toast.success(sandbox ? `${text} (sandbox)` : text);
      else toast.error(text);
    }
    return saved;
  };
  return { t, live, run, sandbox, persona };
}
