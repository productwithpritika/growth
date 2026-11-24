import { create } from "zustand";
import { parsePack, type TenantPack, type WorkbenchTab } from "@/tenants/schema";
import { builtInPack, packById, TENANT_PACKS } from "@/tenants/registry";
import { personaById, type PersonaId } from "@/tenants/personas";
import type { Approval, TenantState } from "@/core/types";
import { recordApproval } from "@/core/actions";
import { seedTenant } from "@/sim/seed";
import { withGrowth } from "@/growth/state";
import { withPlatform } from "@/platform/state";
import { pseudoPack } from "@/platform/pseudo";

const STORAGE_KEY = "monetization-cockpit:records";
const VERSION = 4;

interface Persisted {
  version: number;
  activeTenant: string;
  tenants: Record<string, TenantState>;
}

export type SaveState = "saved" | "unavailable" | "failed" | "unreadable";
export type HubTab = "home" | "usage" | "tables" | "topups" | "limits" | "rewards" | "plan" | "billing" | "lifecycle";
export type BrainTab = "pack" | "regions" | "domain" | "ledger" | "events" | "population" | "chats" | "insights" | "sim" | "approvals" | "checks";
export type Horizon = "crawl" | "walk" | "run";

/** v4: ledger entries carry reason, actor and idempotency key; accounts carry a billing region, a team, limits, table runs and payment health. */
const isV4Tenant = (t: unknown): t is TenantState => {
  const x = t as TenantState;
  return (
    !!x &&
    Array.isArray(x.ledger) &&
    Array.isArray(x.events) &&
    typeof x.clock === "string" &&
    typeof x.cycleStart === "string" &&
    !!x.pack?.demo &&
    !!x.pack?.ledgerPolicy &&
    !!x.hub &&
    x.ledger.every((e) => typeof e.idempotencyKey === "string" && typeof e.reason === "string") &&
    Array.isArray(x.exitSurveys) &&
    Object.values(x.hub).every((h) => typeof h.region === "string" && !!h.consents && Array.isArray(h.runs) && !!h.dunning && !!h.profile && !!h.rewardState && Array.isArray(h.team))
  );
};

function isValid(x: unknown): x is Persisted {
  const p = x as Persisted;
  return !!p && typeof p.activeTenant === "string" && !!p.tenants && typeof p.tenants === "object" && Object.values(p.tenants).every(isV4Tenant);
}

/** Older payloads predate the current ledger rules: keep user-made records, re-seed the ledger from the pack. */
function upgrade(raw: { version?: number; activeTenant?: string; tenants?: Record<string, Record<string, unknown>> }): Persisted | null {
  if (!raw || typeof raw !== "object" || !raw.tenants) return null;
  const now = new Date().toISOString();
  const tenants: Record<string, TenantState> = {};
  for (const [id, old] of Object.entries(raw.tenants)) {
    const builtIn = builtInPack(id);
    // A tenant loaded at runtime keeps its own pack when it still validates; retired built-ins are dropped.
    const parsed = !builtIn && old.custom && old.pack ? parsePack(old.pack) : null;
    const pack = builtIn ?? (parsed?.ok ? parsed.pack : null);
    if (!pack) continue;
    const fresh = seedTenant(pack, now, !builtIn);
    if (!builtIn && Array.isArray(old.approvals)) fresh.approvals = old.approvals as TenantState["approvals"];
    const oldHub = (old.hub ?? {}) as Record<string, Record<string, unknown>>;
    for (const pid of ["maya", "dev"]) {
      const o = oldHub[pid];
      if (!o) continue;
      const h = fresh.hub[pid];
      if (typeof o.topUpCap === "number") h.topUpCap = o.topUpCap;
      if (o.alerts && typeof o.alerts === "object") h.alerts = { ...h.alerts, ...(o.alerts as Record<string, boolean>) };
      if (o.mcpCap === null || typeof o.mcpCap === "number") h.mcpCap = o.mcpCap as number | null;
    }
    if (Array.isArray(old.experiments)) fresh.experiments = old.experiments as TenantState["experiments"];
    if (old.saves && typeof old.saves === "object") fresh.saves = old.saves as Record<string, string>;
    tenants[id] = fresh;
  }
  const ids = Object.keys(tenants);
  if (!ids.length) return null;
  return { version: VERSION, activeTenant: ids.includes(raw.activeTenant ?? "") ? raw.activeTenant! : ids[0], tenants };
}

type ReadResult = { kind: "empty" } | { kind: "ok"; data: Persisted; upgraded?: boolean } | { kind: "unreadable" } | { kind: "unavailable" };

function readStorage(): ReadResult {
  let raw: string | null;
  try {
    raw = window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return { kind: "unavailable" };
  }
  if (raw == null) return { kind: "empty" };
  try {
    const parsed = JSON.parse(raw) as Persisted & { version?: number };
    if ((parsed.version ?? 1) >= VERSION) {
      if (!isValid(parsed)) return { kind: "unreadable" };
      // Phases 3–5 add a growth section; older v4 data gets one without losing anything.
      // Phases 6–8 add a platform section the same way.
      const missing = Object.values(parsed.tenants).some((t) => !t.growth || !t.growth.levers || !t.platform || !t.platform.flags);
      const data = missing ? { ...parsed, tenants: Object.fromEntries(Object.entries(parsed.tenants).map(([k, t]) => [k, withPlatform(withGrowth(t))])) } : parsed;
      return { kind: "ok", data, upgraded: missing };
    }
    const up = upgrade(parsed as never);
    return up ? { kind: "ok", data: up, upgraded: true } : { kind: "unreadable" };
  } catch {
    return { kind: "unreadable" };
  }
}

function writeStorage(data: Persisted): boolean {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    return true;
  } catch {
    return false;
  }
}

function fresh(id = TENANT_PACKS[0]?.id ?? "clay"): Persisted {
  return { version: VERSION, activeTenant: id, tenants: { [id]: seedTenant(packById(id), new Date().toISOString()) } };
}

function initial(): { data: Persisted; saveState: SaveState } {
  const r = readStorage();
  if (r.kind === "ok") {
    if (r.upgraded) writeStorage(r.data);
    return { data: r.data, saveState: "saved" };
  }
  const data = fresh();
  if (r.kind === "empty") return { data, saveState: writeStorage(data) ? "saved" : "failed" };
  return { data, saveState: r.kind };
}

interface CockpitState {
  data: Persisted;
  saveState: SaveState;
  persona: PersonaId;
  horizon: Horizon;
  hubTab: HubTab;
  wbTab: WorkbenchTab;
  brainTab: BrainTab;
  cohort: string;
  wbExperiment: string | null;
  /** Growth Workbench: the selected cohort segment, and the Ask CB drawer. */
  segment: string;
  askOpen: boolean;
  askThreadId: string | null;
  askPrompt: { text: string; via: "palette" | "chip" | "tour" | "typed" | "voice"; n: number } | null;
  /** Phase 6–8: the inner tab of a Workbench page (Evals, MCP Console), presenter overlay, pseudo-locale. */
  wbSub: string | null;
  presenter: boolean;
  pseudo: boolean;
  apply: (fn: (t: TenantState) => TenantState) => boolean;
  setTenant: (id: string) => void;
  addTenant: (pack: TenantPack, approval: Omit<Approval, "id" | "ts">, at?: string) => Approval | null;
  removeTenant: (id: string) => void;
  resetDemo: () => void;
  reload: () => void;
  setPersona: (id: PersonaId) => void;
  setUi: (patch: Partial<Pick<CockpitState, "horizon" | "hubTab" | "wbTab" | "brainTab" | "cohort" | "wbExperiment" | "segment" | "askOpen" | "askThreadId" | "askPrompt" | "wbSub" | "presenter" | "pseudo">>) => void;
}

const init = initial();

export const useCockpit = create<CockpitState>((set, get) => {
  // Re-read the saved value right before each write so another tab's changes are kept.
  const commit = (mutate: (base: Persisted) => Persisted): boolean => {
    const { saveState, data } = get();
    if (saveState === "unreadable" || saveState === "unavailable") {
      set({ data: mutate(data) });
      return false;
    }
    const r = readStorage();
    const base = r.kind === "ok" ? r.data : data;
    const next = mutate(base);
    const ok = writeStorage(next);
    set({ data: next, saveState: ok ? "saved" : "failed" });
    return ok;
  };
  return {
    data: init.data,
    saveState: init.saveState,
    persona: "maya",
    horizon: "run",
    hubTab: "home",
    wbTab: "start",
    brainTab: "pack",
    cohort: "free-capped",
    wbExperiment: null,
    segment: "free-quiet",
    askOpen: false,
    askThreadId: null,
    askPrompt: null,
    wbSub: null,
    presenter: false,
    pseudo: false,
    apply: (fn) =>
      commit((base) => {
        const id = base.activeTenant;
        const t = base.tenants[id] ?? seedTenant(packById(id), new Date().toISOString());
        return { ...base, tenants: { ...base.tenants, [id]: fn(t) } };
      }),
    setTenant: (id) => {
      commit((base) => ({
        ...base,
        activeTenant: id,
        tenants: base.tenants[id] ? base.tenants : { ...base.tenants, [id]: seedTenant(packById(id), new Date().toISOString()) },
      }));
      set({ cohort: "free-capped", wbExperiment: null, segment: "free-quiet", askThreadId: null, askPrompt: null });
    },
    addTenant: (pack, a, at) => {
      let approval: Approval | null = null;
      commit((base) => {
        const seeded = seedTenant(pack, new Date().toISOString(), true);
        const r = recordApproval(seeded, a, JSON.stringify(pack), at);
        approval = r.approval;
        return { ...base, activeTenant: pack.id, tenants: { ...base.tenants, [pack.id]: r.state } };
      });
      set({ cohort: "free-capped", wbExperiment: null });
      return approval;
    },
    removeTenant: (id) => {
      commit((base) => {
        const tenants = { ...base.tenants };
        delete tenants[id];
        const ids = Object.keys(tenants);
        if (!ids.length) return fresh();
        return { ...base, tenants, activeTenant: base.activeTenant === id ? ids[0] : base.activeTenant };
      });
    },
    resetDemo: () => {
      commit(() => fresh(builtInPack(get().data.activeTenant) ? get().data.activeTenant : TENANT_PACKS[0].id));
      set({ hubTab: "home", wbTab: "start", brainTab: "pack", cohort: "free-capped", wbExperiment: null, segment: "free-quiet", askOpen: false, askThreadId: null, askPrompt: null });
    },
    reload: () => {
      const r = readStorage();
      if (r.kind === "ok") set({ data: r.data, saveState: "saved" });
    },
    setPersona: (id) => {
      const p = personaById(id);
      set(p.surface === "workbench" ? { persona: id, wbTab: p.focus ?? "overview", askThreadId: null } : { persona: id, askThreadId: null });
    },
    setUi: (patch) => set(patch),
  };
});

if (typeof window !== "undefined") {
  window.addEventListener("storage", (e) => {
    if (e.key === STORAGE_KEY) useCockpit.getState().reload();
  });
}

const pseudoCache = new WeakMap<TenantState, TenantState>();

/** The active tenant. With the pseudo-locale on, its pack's display strings are stretched (Phase 8 §8.6). */
export function useTenant(): TenantState {
  const t = useCockpit((s) => s.data.tenants[s.data.activeTenant] ?? Object.values(s.data.tenants)[0]);
  const pseudo = useCockpit((s) => s.pseudo);
  if (!pseudo) return t;
  let x = pseudoCache.get(t);
  if (!x) {
    x = { ...t, pack: pseudoPack(t.pack) };
    pseudoCache.set(t, x);
  }
  return x;
}

/** Built-in packs plus tenants loaded at runtime (onboarding or JSON), for the tenant switcher. */
export function useTenantList(): { id: string; company: string; custom: boolean }[] {
  const tenants = useCockpit((s) => s.data.tenants);
  const custom = Object.values(tenants).filter((t) => t.custom);
  return [...TENANT_PACKS.map((p) => ({ id: p.id, company: p.company, custom: false })), ...custom.map((t) => ({ id: t.packId, company: t.pack.company, custom: true }))];
}

export const HORIZON_RANK: Record<Horizon, number> = { crawl: 0, walk: 1, run: 2 };
