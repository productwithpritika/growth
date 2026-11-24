// The demo personas are global: every Tenant Pack gives Maya and Dev an account (demo.hub),
// gives Nia and Sam a merchant role (demo.merchantRoles), and names the teammate the
// "Member" persona plays on Dev's workspace (demo.hub.dev.team, persona: true).
import type { TenantPack, WorkbenchTab } from "@/tenants/schema";

export type PersonaId = "maya" | "dev" | "member" | "nia" | "sam";
/** Personas that own a Credits Hub account. */
export type HubPersonaId = "maya" | "dev";

export interface Persona {
  id: PersonaId;
  name: string;
  surface: "hub" | "workbench";
  focus: WorkbenchTab | null;
}

export const PERSONAS: Persona[] = [
  { id: "maya", name: "Maya", surface: "hub", focus: null },
  { id: "dev", name: "Dev", surface: "hub", focus: null },
  { id: "member", name: "Member", surface: "hub", focus: null },
  { id: "nia", name: "Nia", surface: "workbench", focus: "start" },
  { id: "sam", name: "Sam", surface: "workbench", focus: "today" },
];

export const HUB_PERSONAS: HubPersonaId[] = ["maya", "dev"];

export function personaById(id: string): Persona {
  return PERSONAS.find((p) => p.id === id) ?? PERSONAS[0];
}

/** The Hub account a persona works in: the Member persona is a teammate on Dev's workspace. */
export function accountOfPersona(id: PersonaId): HubPersonaId {
  return id === "member" ? "dev" : id === "maya" ? "maya" : "dev";
}

/** The teammate the Member persona plays in this pack. */
export function memberPersona(pack: TenantPack): { id: string; name: string; title: string } {
  const team = pack.demo.hub.dev.team;
  const m = team.find((x) => x.persona) ?? team.find((x) => x.role === "member");
  if (m) return { id: m.id, name: m.name, title: m.title };
  const owner = pack.demo.hub.dev.workflows[0]?.owner ?? "Teammate";
  const [name, title = "Member"] = owner.split(" · ");
  return { id: slugOf(name), name, title };
}

export function slugOf(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "member";
}

export function personaName(pack: TenantPack, id: PersonaId): string {
  return id === "member" ? memberPersona(pack).name : personaById(id).name;
}

export function personaRole(pack: TenantPack, id: PersonaId, planName?: string): string {
  if (id === "nia" || id === "sam") return pack.demo.merchantRoles[id];
  if (id === "member") return `${memberPersona(pack).title} on Dev's team · Member`;
  const d = pack.demo.hub[id];
  const seats = d.seats > 1 ? ` · ${d.seats} seats` : "";
  return `${d.role}${planName ? ` · ${planName}` : ""}${seats}`;
}
