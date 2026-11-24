// Portal experience (Moment) lifecycle: draft from plain words, revise, preview in the Credits Hub,
// publish behind approval with versions, and roll back in one click.
import type { TenantState } from "@/core/types";
import { audit } from "@/growth/state";
import { composeMoment, latestDef, validateMoment } from "@/platform/moments";
import type { MomentDef, PortalMoment } from "@/platform/types";

export interface PRes {
  t: TenantState;
  ok: boolean;
  text: string;
  id?: string;
}

const setPortal = (t: TenantState, fn: (m: PortalMoment[]) => PortalMoment[]): TenantState => ({ ...t, platform: { ...t.platform, portal: { moments: fn(t.platform.portal.moments) } } });
const mapM = (t: TenantState, id: string, fn: (m: PortalMoment) => PortalMoment) => setPortal(t, (ms) => ms.map((m) => (m.id === id ? fn(m) : m)));
const log = (t: TenantState, actor: string, what: string, decision: "approved" | "recorded" | "rejected" = "recorded") => ({ ...t, growth: audit(t.growth, { ts: t.clock, actor, workflow: "offers", what: `Portal · ${what}`, decision, thread: null, message: null, diff: [] }).g });

export function draftMoment(t: TenantState, prompt: string, by: string): PRes {
  const c = composeMoment(t.pack, prompt);
  if (!c.def || c.errors.length) return { t, ok: false, text: c.errors[0] ?? "Couldn't compose a moment." };
  const def = c.def;
  const existing = t.platform.portal.moments.find((m) => m.id === def.id);
  if (existing) return { t, ok: true, text: "That moment already exists.", id: existing.id };
  const m: PortalMoment = { id: def.id, prompt, versions: [def], live: null, previewing: false, pending: null, history: [{ ts: t.clock, action: "drafted", by, version: 1 }] };
  return { t: log(setPortal(t, (ms) => [m, ...ms]), by, `Drafted moment "${def.name}"`), ok: true, text: `Drafted "${def.name}".`, id: m.id };
}

/** A new version from edited words or edited JSON. */
export function reviseMoment(t: TenantState, id: string, input: { prompt?: string; def?: MomentDef }, by: string): PRes {
  const m = t.platform.portal.moments.find((x) => x.id === id);
  if (!m) return { t, ok: false, text: "Moment not found." };
  const prev = latestDef(m);
  let def: MomentDef;
  if (input.def) {
    const issues = validateMoment({ ...input.def, id: prev.id, version: prev.version + 1 }, t.pack);
    if (issues.length) return { t, ok: false, text: issues[0] };
    def = { ...input.def, id: prev.id, version: prev.version + 1 };
  } else {
    const c = composeMoment(t.pack, input.prompt ?? m.prompt, prev);
    if (!c.def || c.errors.length) return { t, ok: false, text: c.errors[0] ?? "Couldn't compose a moment." };
    def = c.def;
  }
  const next = mapM(t, id, (x) => ({ ...x, prompt: input.prompt ?? x.prompt, versions: [...x.versions, def], history: [...x.history, { ts: t.clock, action: "drafted", by, version: def.version }] }));
  return { t: log(next, by, `Revised moment "${def.name}" to v${def.version}`), ok: true, text: `Version ${def.version} drafted.`, id };
}

export function previewMoment(t: TenantState, id: string, on: boolean, by: string): PRes {
  const m = t.platform.portal.moments.find((x) => x.id === id);
  if (!m) return { t, ok: false, text: "Moment not found." };
  const next = mapM(t, id, (x) => ({ ...x, previewing: on, history: on ? [...x.history, { ts: t.clock, action: "previewed", by, version: latestDef(x).version }] : x.history }));
  return { t: next, ok: true, text: on ? "Previewing in the Credits Hub (only you see it)." : "Preview off." };
}

/** Publish a version. Callers reach this only after an approval (the UI's approval sheet or an approved MCP call). */
export function publishMoment(t: TenantState, id: string, version: number | null, approver: string): PRes {
  const m = t.platform.portal.moments.find((x) => x.id === id);
  if (!m) return { t, ok: false, text: "Moment not found." };
  const v = version ?? latestDef(m).version;
  const def = m.versions.find((x) => x.version === v);
  if (!def) return { t, ok: false, text: `No version ${v}.` };
  const issues = validateMoment(def, t.pack);
  if (issues.length) return { t, ok: false, text: `Not valid: ${issues[0]}` };
  const next = mapM(t, id, (x) => ({ ...x, live: v, previewing: false, pending: null, history: [...x.history, { ts: t.clock, action: "published", by: approver, version: v }] }));
  return { t: log(next, approver, `Published "${def.name}" v${v}`, "approved"), ok: true, text: `Version ${v} is live in the Credits Hub.`, id };
}

/** Roll back to the previously published version, or unpublish if there is none. */
export function rollbackMoment(t: TenantState, id: string, by: string): PRes {
  const m = t.platform.portal.moments.find((x) => x.id === id);
  if (!m || m.live == null) return { t, ok: false, text: "Nothing is live to roll back." };
  // Replay publishes and rollbacks as a stack: the version under the live one is what comes back.
  const stack: number[] = [];
  for (const h of m.history) {
    if (h.action === "published") stack.push(h.version);
    else if (h.action === "rolled-back" || h.action === "unpublished") stack.pop();
  }
  stack.pop();
  const prev = stack.length ? stack[stack.length - 1] : null;
  const next = mapM(t, id, (x) => ({ ...x, live: prev, history: [...x.history, { ts: t.clock, action: prev == null ? "unpublished" : "rolled-back", by, version: prev ?? m.live! }] }));
  return { t: log(next, by, prev == null ? `Unpublished moment ${id}` : `Rolled moment ${id} back to v${prev}`), ok: true, text: prev == null ? "Unpublished. Customers no longer see it." : `Rolled back to version ${prev}.` };
}

export function deleteMomentDraft(t: TenantState, id: string): PRes {
  const m = t.platform.portal.moments.find((x) => x.id === id);
  if (!m) return { t, ok: false, text: "Moment not found." };
  if (m.live != null) return { t, ok: false, text: "Unpublish it before deleting." };
  return { t: setPortal(t, (ms) => ms.filter((x) => x.id !== id)), ok: true, text: "Draft deleted." };
}
