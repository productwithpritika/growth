// Governance for a workspace: who can do what (role matrix), spend and usage limits per
// member, table and workspace, and the audit trail. Pure helpers; the actions that change
// state live in core/hub-actions.ts.
import type { TenantPack } from "@/tenants/schema";
import type { AuditEntry, HubAccountState, SpendLimit, TeamMember, TeamRole, UsageEvent } from "@/core/types";
import { slugOf } from "@/tenants/personas";
import { r2 } from "@/core/time";

export type Capability = "run" | "request" | "buy" | "auto" | "limits" | "roles" | "approve" | "plan" | "payment" | "usage.all";

export const CAPABILITIES: { id: Capability; label: string; detail: string }[] = [
  { id: "run", label: "Run tables and enrichments", detail: "Spends credits within any limits" },
  { id: "request", label: "Request credits", detail: "Sends a request to the admins" },
  { id: "usage.all", label: "See everyone's usage", detail: "Members see their own and the workspace total" },
  { id: "buy", label: "Buy top-ups", detail: "Charges the card on file" },
  { id: "auto", label: "Set auto top-up", detail: "Threshold, amount and monthly cap" },
  { id: "approve", label: "Approve credit requests", detail: "One tap from e-mail or chat" },
  { id: "payment", label: "Payment methods and invoices", detail: "Cards, addresses, tax IDs" },
  { id: "limits", label: "Set limits and alerts", detail: "Per member, table and workspace" },
  { id: "plan", label: "Change plan, pause or cancel", detail: "With proration and undo" },
  { id: "roles", label: "Change roles", detail: "Every change lands in the audit log" },
];

export const ROLE_MATRIX: Record<TeamRole, Capability[]> = {
  admin: ["run", "usage.all", "buy", "auto", "approve", "payment", "limits", "plan", "roles"],
  billing: ["run", "usage.all", "buy", "auto", "approve", "payment"],
  member: ["run", "request"],
};

export const ROLE_LABEL: Record<TeamRole, string> = { admin: "Admin", billing: "Billing", member: "Member" };

export function can(role: TeamRole, c: Capability): boolean {
  return ROLE_MATRIX[role].includes(c);
}

/** "Ana · SDR lead" → "ana"; "Whole team" → "team". */
export function memberIdOfOwner(owner: string): string {
  const name = owner.split(" · ")[0].trim();
  return /^whole team$/i.test(name) ? "team" : slugOf(name);
}

/** The workspace team from the pack, or derived from workflow owners when the pack names none. */
export function seedTeam(pack: TenantPack, personaId: "maya" | "dev"): TeamMember[] {
  const demo = pack.demo.hub[personaId];
  if (demo.team.length) return demo.team.map((m) => ({ id: m.id, name: m.name, title: m.title, role: m.role, persona: m.persona }));
  const self: TeamMember = { id: personaId, name: personaId === "dev" ? "Dev" : "Maya", title: demo.role, role: "admin" };
  if (personaId === "maya") return [self];
  const seen = new Set<string>([self.id]);
  const out: TeamMember[] = [self];
  for (const w of demo.workflows) {
    const id = memberIdOfOwner(w.owner);
    if (id === "team" || seen.has(id)) continue;
    seen.add(id);
    const [name, title = ""] = w.owner.split(" · ");
    out.push({ id, name, title, role: "member", persona: out.length === 1 });
  }
  return out;
}

export function memberName(hub: HubAccountState, id: string): string {
  if (id === "team") return "Whole team";
  return hub.team.find((m) => m.id === id)?.name ?? id;
}

export interface LimitStatus {
  limit: SpendLimit;
  spent: number;
  pct: number;
  state: "ok" | "near" | "warn" | "block";
}

function spentOn(events: UsageEvent[], account: string, cycleStart: Date, meter: string, f: (e: UsageEvent) => boolean): number {
  let s = 0;
  const t0 = cycleStart.getTime();
  for (const e of events) if (e.account === account && e.type === "usage" && new Date(e.ts).getTime() >= t0 && f(e)) s += e.meters?.[meter] ?? 0;
  return r2(s);
}

/** Every limit that applies to a run by this member on this table, with what is already spent against it this cycle. */
export function limitsFor(hub: HubAccountState, events: UsageEvent[], account: string, cycleStart: Date, who: { member: string; tableId: string; table: string }, pending: Record<string, number> = {}): LimitStatus[] {
  const out: LimitStatus[] = [];
  for (const l of hub.limits) {
    const applies = l.scope === "workspace" || (l.scope === "member" && l.target === who.member) || (l.scope === "table" && l.target === who.tableId);
    if (!applies) continue;
    const f = l.scope === "workspace" ? () => true : l.scope === "member" ? (e: UsageEvent) => e.member === who.member : (e: UsageEvent) => e.workflow === who.table;
    const spent = r2(spentOn(events, account, cycleStart, l.meter, f) + (pending[l.meter] ?? 0));
    const pct = l.amount > 0 ? spent / l.amount : 1;
    const state = pct >= 1 ? (l.behaviour === "block" ? "block" : "warn") : pct >= 0.8 ? "near" : "ok";
    out.push({ limit: l, spent, pct, state });
  }
  return out;
}

export function limitTargetLabel(hub: HubAccountState, l: SpendLimit, tableName: (id: string) => string): string {
  if (l.scope === "workspace") return "Whole workspace";
  if (l.scope === "member") return memberName(hub, l.target);
  return tableName(l.target);
}

export function auditEntry(hub: HubAccountState, ts: string, actor: string, area: AuditEntry["area"], what: string, from: string | null = null, to: string | null = null): AuditEntry {
  const e: AuditEntry = { id: `au_${hub.audit.length + 1}_${ts.slice(11, 19).replace(/:/g, "")}`, ts, actor, area, what, from, to };
  hub.audit.push(e);
  return e;
}

/** "user:dev" → "Dev"; "system:auto-top-up" → "Auto top-up". */
export function actorLabel(hub: HubAccountState, actor: string): string {
  const [kind, id = ""] = actor.split(":");
  if (kind === "user" || kind === "member") return memberName(hub, id) === id ? id.charAt(0).toUpperCase() + id.slice(1) : memberName(hub, id);
  if (kind === "system") return id ? id.replace(/-/g, " ").replace(/^./, (c) => c.toUpperCase()) : "System";
  if (kind === "merchant") return `${id.charAt(0).toUpperCase()}${id.slice(1)} (merchant)`;
  if (kind === "agent") return `Agent · ${id}`;
  return actor;
}
