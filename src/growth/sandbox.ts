// The tour's sandbox (Phase 3 §3.5): while the tour runs for a persona, Workbench writes land on
// a copy whose experiments, Ask CB threads and audiences live on the tour itself. A sandbox write
// can change nothing else: the pack, ledger, Hub accounts and CB credits always come from live.
import type { TenantState } from "@/core/types";
import type { TourState } from "@/growth/types";
import { initialTour } from "@/growth/state";

export function tourOf(t: TenantState, persona: string): TourState {
  return t.growth.tours[persona] ?? initialTour(persona);
}

export function tourActive(t: TenantState, persona: string): boolean {
  const tr = t.growth.tours[persona];
  return !!tr && (tr.status === "running" || tr.status === "paused") && !!tr.sandbox;
}

/** The tenant the Workbench shows: the sandbox while the tour runs. */
export function sandboxView(live: TenantState, persona: string): TenantState {
  const tr = live.growth.tours[persona];
  if (!tr || !tr.sandbox || !(tr.status === "running" || tr.status === "paused")) return live;
  return { ...live, growth: { ...live.growth, lab: tr.sandbox.lab, audiences: tr.sandbox.audiences, ask: { ...live.growth.ask, threads: tr.sandbox.threads } } };
}

/** Apply `fn` to the sandbox and keep only what a sandbox may change. */
export function writeSandbox(live: TenantState, persona: string, fn: (s: TenantState) => TenantState): TenantState {
  const view = sandboxView(live, persona);
  const next = fn(view);
  const tour = next.growth.tours[persona] ?? tourOf(live, persona);
  return {
    ...live,
    growth: {
      ...live.growth,
      telemetry: next.growth.telemetry,
      memory: next.growth.memory,
      onboarding: next.growth.onboarding,
      tours: { ...live.growth.tours, [persona]: { ...tour, sandbox: { lab: next.growth.lab, threads: next.growth.ask.threads, audiences: next.growth.audiences } } },
    },
  };
}

