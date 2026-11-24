// Phases 6–8 state on TenantState.platform: seeding, migration of saved data, and the daily step
// the Time machine drives (scheduled re-evals, canaries, agent triggers).
import type { TenantState } from "@/core/types";
import type { TenantPack } from "@/tenants/schema";
import { fnv1a } from "@/core/time";
import { initEvals } from "@/platform/evals";
import { stepEvals } from "@/platform/eval-actions";
import { ROSTER, stepAgents } from "@/platform/agents";
import { initFlags, seedReleases } from "@/platform/release";
import { SERVERS } from "@/platform/mcp";
import type { PlatformState, Principal } from "@/platform/types";

const ALL = SERVERS.map((s) => s.id);

function seedPrincipals(pack: TenantPack, clockIso: string): Principal[] {
  const p = (x: Omit<Principal, "tenant" | "fingerprint" | "createdAt" | "revoked">): Principal => ({ ...x, tenant: pack.id, fingerprint: fnv1a(`${pack.id}|${x.id}`).slice(0, 8), createdAt: clockIso, revoked: false });
  return [
    p({ id: "human:nia", label: "Nia (console)", kind: "human", role: "operator", tier: "approval", servers: ALL, account: null, rateLimitPerMin: 120 }),
    p({ id: "assistant:askcb", label: "Ask CB", kind: "assistant", role: "operator", tier: "approval", servers: ALL, account: null, rateLimitPerMin: 120 }),
    ...ROSTER.map((a) =>
      p({ id: `agent:${a.id}`, label: a.name, kind: "agent", role: a.tier === "read" ? "viewer" : a.tier === "draft" ? "analyst" : a.tier === "approval" ? "operator" : "automation", tier: a.tier, servers: a.servers, account: null, rateLimitPerMin: 120 }),
    ),
    p({ id: "ext:generic", label: "Generic AI client · Dev's workspace", kind: "external", role: "operator", tier: "approval", servers: ["credits"], account: "dev", rateLimitPerMin: 30 }),
  ];
}

export function initPlatform(pack: TenantPack, clockIso: string): PlatformState {
  return {
    evals: initEvals(pack, clockIso),
    mcp: {
      killSwitch: false,
      constraints: {
        grant_reward: { amount: { min: 1, max: 50 }, expiryDays: { default: 7, max: 30 } },
        set_spend_limit: { amount: { min: 0, max: 50000 } },
        set_auto_topup: { monthlyCap: { max: 500 } },
        grant_from_breakage: { creditsEach: { max: 50 } },
      },
      principals: seedPrincipals(pack, clockIso),
      activity: [],
      approvals: [],
      budgets: { creditsPerDay: 200, spendPerDay: 100, concurrentExperiments: 6, approvedBy: "Sam" },
      spent: { day: clockIso.slice(0, 10), credits: 0, usd: 0 },
    },
    agents: { paused: { winback: true }, runs: [] },
    portal: { moments: [] },
    embed: { modules: ["balance", "topups", "plan"], mode: "drawer", hosting: "embedded", hooks: ["onMomentShown", "onTopupStarted", "onPlanChanged"], events: [] },
    flags: initFlags(),
    releases: seedReleases(clockIso),
    deletions: [],
  };
}

/** Saved tenants from before Phase 6 get a platform section; nothing else changes. */
export function withPlatform(t: TenantState): TenantState {
  const p = t.platform as PlatformState | undefined;
  if (p && p.evals && p.mcp && p.agents && p.portal && p.embed && p.flags && Array.isArray(p.releases)) return t;
  return { ...t, platform: initPlatform(t.pack, t.clock) };
}

/** Once per simulated day, after the growth step. */
export function stepPlatform(t0: TenantState): TenantState {
  if (!t0.platform) return t0;
  let t = stepEvals(t0);
  t = stepAgents(t);
  return t;
}
