// The quality gate as a launch check (Phase 6 §6.6): any experiment or default change that touches
// a skill needs a passing eval. Fail blocks unless an approved, audited override exists; warn is
// shown but does not block.
import type { TenantState } from "@/core/types";
import type { LabExperiment } from "@/growth/types";
import type { LaunchIssue } from "@/growth/lab";
import { gateFor, modelName } from "@/platform/evals";

export function approvedOverride(t: TenantState, skillId: string, model: string, experimentId: string | null) {
  return t.platform?.evals.overrides.find((o) => o.skillId === skillId && o.model === model && o.status === "approved" && (o.experimentId === experimentId || o.experimentId === null)) ?? null;
}

export function skillGateIssues(t: TenantState, e: Pick<LabExperiment, "id" | "skill">): LaunchIssue[] {
  if (!e.skill || !t.platform) return [];
  const ev = t.platform.evals;
  const skill = ev.skills.find((s) => s.id === e.skill!.id);
  const name = skill?.manifest.name ?? e.skill.id;
  const g = gateFor(ev, t.pack, e.skill.id, e.skill.to);
  if (g.state === "pass") return [];
  if (g.state === "warn") return [{ level: "warn", text: `Quality gate warns for ${name} on ${modelName(e.skill.to)}: ${g.reasons.find((r) => !r.startsWith("Within")) ?? g.reasons[0]}` }];
  const o = approvedOverride(t, e.skill.id, e.skill.to, e.id);
  if (o) return [{ level: "warn", text: `Quality gate ${g.state === "none" ? "has no eval" : "failed"}; launch allowed by an override approved by ${o.decidedBy} ("${o.reason}").` }];
  return [{ level: "block", text: g.state === "none" ? `Quality gate: ${name} on ${modelName(e.skill.to)} has no eval yet. Run one in Evals, or request an override with a reason.` : `Quality gate failed for ${name} on ${modelName(e.skill.to)}: ${g.reasons.find((r) => !r.startsWith("Within")) ?? g.reasons[0]} Request an override with a reason, or pick another model.` }];
}
