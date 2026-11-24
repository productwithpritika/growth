import { useCockpit } from "@/lib/cockpit-store";
import { accountOfPersona, personaById } from "@/tenants/personas";
import { CreditsHubPage } from "@/surfaces/credits-hub/page";
import { WorkbenchPage } from "@/surfaces/workbench/page";

/** "/" is the current persona's home: the Credits Hub for Maya, Dev and the Member, the Growth Workbench for Nia and Sam. */
export function HomePage() {
  const persona = useCockpit((s) => s.persona);
  const p = personaById(persona);
  if (p.surface === "workbench") return <WorkbenchPage personaId={p.id as "nia" | "sam"} />;
  return <CreditsHubPage key={p.id} personaId={accountOfPersona(p.id)} viewer={p.id === "member" ? "member" : "owner"} />;
}
