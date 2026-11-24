// Shared hook for the Phase 6–8 surfaces: the live tenant, who is acting, and three ways to write.
// These surfaces always write to the live tenant (the tour sandbox covers the Phase 3–5 loop only).
import { toast } from "sonner";
import type { TenantState } from "@/core/types";
import { useCockpit, useTenant } from "@/lib/cockpit-store";
import { personaName, type PersonaId } from "@/tenants/personas";
import { invoke, type CallRequest } from "@/platform/mcp";
import type { McpActivity } from "@/platform/types";

export interface Outcome {
  t: TenantState;
  ok: boolean;
  text: string;
  id?: string;
}

export function usePlatform() {
  const t = useTenant();
  const apply = useCockpit((s) => s.apply);
  const persona = useCockpit((s) => s.persona);
  const setUi = useCockpit((s) => s.setUi);
  const who = personaName(t.pack, persona as PersonaId);

  /** Apply a state change and toast `okText`. */
  const run = (fn: (s: TenantState) => TenantState, okText: string, quiet = false) => {
    const saved = apply(fn);
    if (!quiet) (saved ? toast.success : toast.error)(saved ? okText : `${okText} Not saved in this browser.`);
    return saved;
  };

  /** Apply an action that can refuse; toasts its text either way. */
  const act = (fn: (s: TenantState) => Outcome, quiet = false): Outcome | null => {
    let res: Outcome | null = null;
    const saved = apply((s) => {
      res = fn(s);
      return res.ok ? res.t : s;
    });
    const r = res as Outcome | null;
    if (r && !quiet) {
      if (!r.ok) toast.error(r.text);
      else (saved ? toast.success : toast.error)(saved ? r.text : `${r.text} Not saved in this browser.`);
    }
    return r;
  };

  /** One MCP call through the gateway; returns the logged activity. */
  const call = (req: CallRequest): McpActivity | null => {
    let a: McpActivity | null = null;
    apply((s) => {
      const r = invoke(s, req);
      a = r.activity;
      return r.t;
    });
    return a;
  };

  const askCb = (text: string) => setUi({ askOpen: true, askPrompt: { text, via: "chip", n: Date.now() } });

  return { t, apply, persona, who, run, act, call, askCb, setUi };
}
