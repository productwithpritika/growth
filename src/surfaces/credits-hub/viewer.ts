// Who is looking at the Credits Hub: the account they work in, their team member record and
// role, and what that role can do (core/team ROLE_MATRIX). Role changes in Limits apply live.
import type { TenantState, TeamRole } from "@/core/types";
import { can as roleCan, type Capability } from "@/core/team";
import { accountOfPersona, memberPersona, type HubPersonaId, type PersonaId } from "@/tenants/personas";

export interface HubViewer {
  account: HubPersonaId;
  /** Team member id; also the actor id ("user:<id>"). */
  id: string;
  name: string;
  role: TeamRole;
  isMemberPersona: boolean;
  actor: string;
  can: (c: Capability) => boolean;
}

export function hubViewer(t: TenantState, persona: PersonaId): HubViewer {
  const account = accountOfPersona(persona);
  const hub = t.hub[account];
  const isMemberPersona = persona === "member";
  const id = isMemberPersona ? memberPersona(t.pack).id : account;
  const m = hub?.team.find((x) => x.id === id);
  const role: TeamRole = m?.role ?? (isMemberPersona ? "member" : "admin");
  const name = m?.name ?? (isMemberPersona ? memberPersona(t.pack).name : account === "dev" ? "Dev" : "Maya");
  return { account, id, name, role, isMemberPersona, actor: `user:${id}`, can: (c) => roleCan(role, c) };
}
