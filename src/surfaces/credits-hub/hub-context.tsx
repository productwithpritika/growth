// Shared context for the Credits Hub tabs: the tenant, the account, who is looking (role and
// capabilities), and three ways to change state: run (toast + announce), act (needs the
// action's result) and silent (live ticks that shouldn't toast).
import { createContext, useContext } from "react";
import type { TenantState } from "@/core/types";
import type { HubTab } from "@/lib/cockpit-store";
import type { HubViewer } from "@/surfaces/credits-hub/viewer";

export type RunFn = (fn: (s: TenantState) => TenantState, okText: string) => void;
export type ActFn = <R>(fn: (s: TenantState) => { state: TenantState; result: R }, message: (r: R) => { ok: boolean; text: string } | null) => R | undefined;

export interface HubCtx {
  t: TenantState;
  account: "maya" | "dev";
  viewer: HubViewer;
  run: RunFn;
  act: ActFn;
  silent: (fn: (s: TenantState) => TenantState) => boolean;
  goTab: (tab: HubTab) => void;
}

export const HubContext = createContext<HubCtx | null>(null);

export function useHub(): HubCtx {
  const c = useContext(HubContext);
  if (!c) throw new Error("useHub outside the Credits Hub");
  return c;
}
