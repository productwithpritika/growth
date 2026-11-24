import { useRef, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Bot, FileJson, Play, RotateCcw, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { SectionTitle, Stat } from "@/ui/primitives";
import { ToneBadge } from "@/ui/tone";
import { AgentNarrator, type NarratorStep } from "@/ui/agent-narrator";
import { ToolCallTrace } from "@/ui/tool-call-trace";
import { ApprovalSheet } from "@/ui/approval-sheet";
import { complete, extractJson } from "@/agents/llm-gateway";
import { EXAMPLE_BRIEF, ONBOARD_STEPS, PATTERNS, draftPrompt, examplePack, packDiff, packRisk, repairPrompt, scaffold, slugId, type OnboardBrief, type OnboardStepId } from "@/agents/onboarding";
import { callTool } from "@/mcp/registry";
import type { ToolCall } from "@/mcp/types";
import { parsePack, type PackIssue, type TenantPack } from "@/tenants/schema";
import { builtInPack } from "@/tenants/registry";
import type { PackPreview } from "@/sim/preview";
import { auditId, recordApproval } from "@/core/actions";
import { fmtPct, fmtUsd } from "@/core/format";
import { useCockpit, useTenant } from "@/lib/cockpit-store";
import { personaById } from "@/tenants/personas";

interface RunState {
  steps: NarratorStep[];
  json: string;
  calls: ToolCall[];
  issues: PackIssue[];
  preview: PackPreview | null;
  pack: TenantPack | null;
  live: string;
}

const blank = (): RunState => ({
  steps: ONBOARD_STEPS.map((s) => ({ id: s.id, label: s.label, status: "pending", by: s.by })),
  json: "",
  calls: [],
  issues: [],
  preview: null,
  pack: null,
  live: "",
});

const ORDER = ONBOARD_STEPS.map((s) => s.id);

export function OnboardPanel() {
  const t = useTenant();
  const addTenant = useCockpit((s) => s.addTenant);
  const apply = useCockpit((s) => s.apply);
  const setPersona = useCockpit((s) => s.setPersona);
  const approver = personaById(useCockpit((s) => s.persona)).name;
  const [brief, setBrief] = useState<OnboardBrief>({ company: "", description: "", pattern: "builderco" });
  const [s, setS] = useState<RunState>(blank);
  const sRef = useRef<RunState>(s);
  const [history, setHistory] = useState<RunState[]>([]);
  const [running, setRunning] = useState(false);
  const [takenOver, setTakenOver] = useState(false);
  const stopRef = useRef(false);
  const [sheet, setSheet] = useState<{ open: boolean; ts: string }>({ open: false, ts: "" });
  const [loaded, setLoaded] = useState<{ id: string; company: string; audit: string } | null>(null);

  const push = (next: RunState) => {
    sRef.current = next;
    setS(next);
  };
  const mark = (id: OnboardStepId, status: NarratorStep["status"], detail?: string, by?: NarratorStep["by"]) => {
    const cur = sRef.current;
    const label = ONBOARD_STEPS.find((x) => x.id === id)?.label ?? id;
    push({
      ...cur,
      steps: cur.steps.map((x) => (x.id === id ? { ...x, status, detail: detail ?? x.detail, by: by ?? x.by } : x)),
      live: status === "running" ? `${label}…` : status === "failed" ? `${label}: failed. ${detail ?? ""}` : status === "done" ? `${label}: done.` : cur.live,
    });
  };
  const trace = (c: ToolCall) => push({ ...sRef.current, calls: [...sRef.current.calls, c] });

  const validate = (json: string): { pack: TenantPack | null; issues: PackIssue[] } => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(json);
    } catch {
      return { pack: null, issues: [{ path: "(root)", message: "Not valid JSON" }] };
    }
    const call = callTool("tenant.validate_pack", { pack: parsed }, t);
    trace(call);
    const r = parsePack(parsed);
    return r.ok ? { pack: r.pack, issues: [] } : { pack: null, issues: r.issues };
  };

  const draftFrom = async (prompt: string): Promise<unknown | null> => {
    const res = await complete(prompt);
    return extractJson(res.text);
  };

  async function go(from: OnboardStepId, manual: boolean) {
    setRunning(true);
    stopRef.current = false;
    let i = ORDER.indexOf(from);
    try {
      while (i < ORDER.length) {
        if (stopRef.current) {
          push({ ...sRef.current, live: "You have control. Edit the draft, then validate it." });
          break;
        }
        const id = ORDER[i];
        setHistory((h) => [...h, sRef.current]);
        const who = manual && (id === "draft" || id === "repair") ? "you" : undefined;
        mark(id, "running", undefined, who);
        if (id === "read") {
          const call = callTool("tenant.get_pack", {}, t);
          trace(call);
          const ex = builtInPack(brief.pattern);
          mark("read", "done", `Brief: ${brief.description.trim().split(/\s+/).length} words. Example: ${ex?.company ?? brief.pattern} pack (${ex?.meters.length ?? 0} meter${ex?.meters.length === 1 ? "" : "s"}, ${ex?.plans.length ?? 0} plans).`);
          i++;
        } else if (id === "draft") {
          let obj: unknown | null = null;
          try {
            obj = await draftFrom(draftPrompt(brief));
          } catch (e) {
            mark("draft", "failed", e instanceof Error ? e.message : "The agent didn't answer.");
            return;
          }
          if (!obj) {
            mark("draft", "failed", "The agent's answer had no JSON in it. Run it again or take over with a template.");
            return;
          }
          push({ ...sRef.current, json: JSON.stringify(obj, null, 2) });
          const o = obj as { meters?: unknown[]; plans?: unknown[]; topUpPacks?: unknown[] };
          mark("draft", "done", `${o.meters?.length ?? 0} meters, ${o.plans?.length ?? 0} plans, ${o.topUpPacks?.length ?? 0} top-up packs.`);
          i++;
        } else if (id === "scaffold") {
          let obj: unknown;
          try {
            obj = JSON.parse(sRef.current.json);
          } catch {
            mark("scaffold", "failed", "The draft isn't valid JSON.");
            return;
          }
          const r = scaffold(obj, brief);
          push({ ...sRef.current, json: JSON.stringify(r.pack, null, 2) });
          mark("scaffold", "done", `Accounts for Maya and Dev, roles for Nia and Sam, 260 customer accounts.${r.filled.length ? ` Filled from the example: ${r.filled.join(", ")}.` : ""}`);
          i++;
        } else if (id === "validate") {
          const v = validate(sRef.current.json);
          push({ ...sRef.current, issues: v.issues, pack: v.pack });
          if (v.pack) {
            mark("validate", "done", "Valid.");
            if (sRef.current.steps.find((x) => x.id === "repair")?.status === "pending") mark("repair", "skipped", "Nothing to fix.");
            i = ORDER.indexOf("simulate");
          } else if (manual) {
            mark("validate", "failed", `${v.issues.length} issue${v.issues.length === 1 ? "" : "s"}. Fix them in the draft and validate again.`);
            return;
          } else {
            mark("validate", "failed", `${v.issues.length} issue${v.issues.length === 1 ? "" : "s"}. Handing them back to the agent.`);
            i = ORDER.indexOf("repair");
          }
        } else if (id === "repair") {
          let obj: unknown | null = null;
          try {
            obj = await draftFrom(repairPrompt(brief, sRef.current.json, sRef.current.issues));
          } catch (e) {
            mark("repair", "failed", e instanceof Error ? e.message : "The agent didn't answer.");
            return;
          }
          if (!obj) {
            mark("repair", "failed", "The agent's answer had no JSON in it. Take over to fix the draft yourself.");
            return;
          }
          const json = JSON.stringify(scaffold(obj, brief).pack, null, 2);
          const v = validate(json);
          push({ ...sRef.current, json, issues: v.issues, pack: v.pack });
          if (!v.pack) {
            mark("repair", "failed", `Still ${v.issues.length} issue${v.issues.length === 1 ? "" : "s"} after one repair. Take over to fix them.`);
            return;
          }
          mark("repair", "done", "Fixed and re-validated.");
          mark("validate", "done", "Valid after repair.");
          i = ORDER.indexOf("simulate");
        } else if (id === "simulate") {
          const pack = sRef.current.pack!;
          const call = callTool("sim.preview_pack", { pack }, t);
          trace(call);
          const preview = call.status === "ok" ? (call.result as PackPreview) : null;
          push({ ...sRef.current, preview });
          if (!preview) {
            mark("simulate", "failed", call.summary);
            return;
          }
          mark("simulate", "done", `${preview.accounts} accounts, ${fmtUsd(preview.mrr, 0)} MRR, ${fmtPct(preview.marginPct)} margin.`);
          i++;
        } else if (id === "approve") {
          setSheet({ open: true, ts: new Date().toISOString() });
          push({ ...sRef.current, live: "Waiting for your approval." });
          return;
        }
      }
    } finally {
      setRunning(false);
    }
  }

  const start = (e: FormEvent) => {
    e.preventDefault();
    if (!brief.company.trim() || !brief.description.trim()) return;
    const existing = builtInPack(slugId(brief.company));
    if (existing) {
      toast.error(`${existing.company} is a shipped pack. Use another company name.`);
      return;
    }
    setHistory([]);
    setTakenOver(false);
    setLoaded(null);
    push(blank());
    void go("read", false);
  };

  const takeOver = () => {
    stopRef.current = true;
    setTakenOver(true);
    push({ ...sRef.current, live: "Taking over. The agent stops after the current step." });
  };

  const useTemplate = () => {
    const ex = examplePack(brief.pattern);
    const company = brief.company.trim() || "New tenant";
    const brand = { ...(ex.brand as Record<string, unknown>), wordmark: company.slice(0, 30), glyph: company.slice(0, 1).toUpperCase() };
    const json = JSON.stringify({ ...ex, id: slugId(company), company, brand }, null, 2);
    setHistory((h) => [...h, sRef.current]);
    setTakenOver(true);
    const cur = sRef.current;
    push({
      ...cur,
      json,
      steps: cur.steps.map((x) => (x.id === "read" ? { ...x, status: "done" } : x.id === "draft" ? { ...x, status: "done", by: "you", detail: `Started from the ${builtInPack(brief.pattern)?.company ?? ""} template. Not drafted by the agent.` } : x)),
      live: "Template loaded. Edit it, then continue.",
    });
  };

  const undo = () => {
    const prev = history[history.length - 1];
    if (!prev) return;
    setHistory((h) => h.slice(0, -1));
    push({ ...prev, live: "Undid the last step." });
  };

  const continueManual = () => {
    const firstOpen = (sRef.current.steps.find((x) => x.status !== "done" && x.status !== "skipped")?.id ?? "validate") as OnboardStepId;
    const from: OnboardStepId = firstOpen === "read" || firstOpen === "draft" ? "scaffold" : firstOpen === "repair" ? "validate" : firstOpen;
    void go(from, true);
  };

  const pack = s.pack;
  const subject = pack ? JSON.stringify(pack) : "";
  const audit = pack && sheet.ts ? auditId(subject, sheet.ts) : "";
  const risk = pack ? packRisk(pack, s.preview) : { level: "low" as const, reasons: [] };

  const approve = () => {
    if (!pack) return;
    const a = addTenant(pack, { title: `Load ${pack.company} Tenant Pack`, actor: approver, decision: "approved", risk: risk.level, summary: `${pack.meters.length} meter${pack.meters.length === 1 ? "" : "s"}, ${pack.plans.length} plans, ${pack.topUpPacks.length} top-up packs` }, sheet.ts);
    setSheet({ open: false, ts: sheet.ts });
    mark("approve", "done", `Approved by ${approver} · ${a?.id ?? audit}`, "you");
    setLoaded({ id: pack.id, company: pack.company, audit: a?.id ?? audit });
    toast.success(`${pack.company} loaded. The tenant switcher now shows it.`);
  };

  const reject = () => {
    if (!pack) return;
    apply((st) => recordApproval(st, { title: `Load ${pack.company} Tenant Pack`, actor: approver, decision: "rejected", risk: risk.level, summary: "Rejected at review" }, subject, sheet.ts).state);
    setSheet({ open: false, ts: sheet.ts });
    setTakenOver(true);
    mark("approve", "failed", `Rejected by ${approver}. Edit the draft and continue to review it again.`, "you");
  };

  const hasRun = s.steps.some((x) => x.status !== "pending");
  const canEdit = !running && hasRun && !loaded;

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_420px]">
      <div className="min-w-0 space-y-6">
        <section aria-labelledby="brief-title" className="space-y-3">
          <SectionTitle id="brief-title" aside="The agent drafts the commercial model; tools do the rest">
            Onboard a tenant
          </SectionTitle>
          <form onSubmit={start} className="space-y-4 rounded-xl border border-border bg-card p-4">
            <div className="grid gap-4">
              <div className="max-w-sm space-y-1.5">
                <Label htmlFor="ob-company">Company</Label>
                <Input id="ob-company" required maxLength={40} value={brief.company} onChange={(e) => setBrief({ ...brief, company: e.target.value })} disabled={running} />
              </div>
              <fieldset className="space-y-1.5">
                <legend className="type-body font-medium">Closest pattern</legend>
                <RadioGroup value={brief.pattern} onValueChange={(v) => setBrief({ ...brief, pattern: v as OnboardBrief["pattern"] })} className="grid gap-2 sm:grid-cols-3" disabled={running}>
                  {PATTERNS.map((p) => (
                    <Label key={p.id} htmlFor={`ob-p-${p.id}`} className="flex cursor-pointer items-start gap-2 rounded-lg border border-border p-2.5 font-normal has-[[data-state=checked]]:border-primary">
                      <RadioGroupItem id={`ob-p-${p.id}`} value={p.id} className="mt-0.5" />
                      <span>
                        <span className="block type-body font-medium">{p.label}</span>
                        <span className="block type-caption text-muted-foreground">{p.hint}</span>
                      </span>
                    </Label>
                  ))}
                </RadioGroup>
              </fieldset>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ob-desc">What they sell and how they charge</Label>
              <Textarea id="ob-desc" required rows={4} maxLength={1500} value={brief.description} onChange={(e) => setBrief({ ...brief, description: e.target.value })} disabled={running} />
            </div>
            <div className="flex flex-wrap gap-2">
              <Button type="submit" disabled={running || !brief.company.trim() || !brief.description.trim()}>
                <Sparkles aria-hidden="true" />
                Draft with the agent
              </Button>
              <Button type="button" variant="outline" disabled={running} onClick={() => setBrief(EXAMPLE_BRIEF)}>
                Fill an example brief
              </Button>
            </div>
          </form>
        </section>

        {hasRun && (
          <section aria-labelledby="draft-title" className="space-y-3">
            <SectionTitle id="draft-title" aside={canEdit ? "You can edit this draft" : running ? "Read-only while the agent works" : undefined}>
              Draft Tenant Pack
            </SectionTitle>
            {s.json ? (
              <Textarea
                aria-label="Draft Tenant Pack JSON"
                value={s.json}
                readOnly={!canEdit}
                onChange={(e) => push({ ...sRef.current, json: e.target.value, pack: null, preview: null })}
                className="h-[360px] font-mono text-xs"
                spellCheck={false}
              />
            ) : (
              <div className="flex flex-wrap items-center gap-3 rounded-xl border border-dashed border-border p-4 type-body text-muted-foreground">
                <FileJson aria-hidden="true" className="size-5" />
                No draft yet.
                {!running && (
                  <Button size="sm" variant="outline" onClick={useTemplate}>
                    Start from the {builtInPack(brief.pattern)?.company} template instead
                  </Button>
                )}
              </div>
            )}
            {s.issues.length > 0 && (
              <div role="alert" className="space-y-1 rounded-lg border border-blocked bg-blocked-soft p-3 type-caption text-blocked-ink">
                <p className="font-semibold">Validation issues</p>
                <ul className="list-disc pl-5">
                  {s.issues.slice(0, 12).map((x) => (
                    <li key={`${x.path}-${x.message}`}>
                      <span className="font-mono">{x.path}</span>: {x.message}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {canEdit && s.json && (
              <div className="flex flex-wrap gap-2">
                <Button size="sm" onClick={continueManual}>
                  <Play aria-hidden="true" />
                  Validate, simulate and review
                </Button>
                <Button size="sm" variant="outline" onClick={() => void go(s.steps.find((x) => x.id === "draft")?.status === "done" ? "validate" : "draft", false)}>
                  <Bot aria-hidden="true" />
                  Hand back to the agent
                </Button>
              </div>
            )}
          </section>
        )}

        {s.preview && (
          <section aria-labelledby="sim-title" className="space-y-3 rounded-xl border border-border bg-card p-4">
            <SectionTitle id="sim-title" aside="First month, simulated">
              Simulation
            </SectionTitle>
            <PreviewStats preview={s.preview} />
          </section>
        )}

        {loaded && (
          <section aria-labelledby="loaded-title" className="space-y-3 rounded-xl border border-healthy bg-healthy-soft p-4">
            <h3 id="loaded-title" className="type-heading text-healthy-ink">
              {loaded.company} is live in the cockpit
            </h3>
            <p className="type-body">Approval {loaded.audit} is in the Brain's approvals list. The tenant switcher now shows {loaded.company}.</p>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" onClick={() => setPersona("maya")}>
                See Maya's Credits Hub
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setLoaded(null);
                  setHistory([]);
                  setTakenOver(false);
                  push(blank());
                  setBrief({ company: "", description: "", pattern: "builderco" });
                }}
              >
                <RotateCcw aria-hidden="true" />
                Onboard another
              </Button>
            </div>
          </section>
        )}
      </div>

      <aside aria-labelledby="agent-title" className="space-y-4">
        <SectionTitle id="agent-title" aside={running ? <ToneBadge tone="info">Working</ToneBadge> : takenOver && !loaded ? <ToneBadge tone="watch">You have control</ToneBadge> : undefined}>
          Agent plan
        </SectionTitle>
        <div className="rounded-xl border border-border bg-card p-3">
          <AgentNarrator steps={s.steps} running={running} takenOver={takenOver} canUndo={!running && history.length > 0 && !loaded} onTakeOver={takeOver} onUndo={undo} live={s.live} />
        </div>
        <SectionTitle as="h3" aside={`${s.calls.length} calls`}>
          Tool calls
        </SectionTitle>
        <ToolCallTrace calls={s.calls} empty="Tool calls appear here as the agent works." />
        <p className="type-caption text-muted-foreground">Drafting and repair use AI, and each request uses AI credits. Validation, scaffolding and simulation are deterministic tools.</p>
      </aside>

      {pack && (
        <ApprovalSheet
          open={sheet.open}
          onOpenChange={(open) => setSheet({ ...sheet, open })}
          title={`Load ${pack.company} into the cockpit?`}
          description={`${approver} approves for Chargebee. Loading adds the tenant to the switcher and seeds its ledger; nothing is billed.`}
          preview={s.preview ? <PreviewStats preview={s.preview} /> : <p className="type-body">No simulation.</p>}
          diff={packDiff(null, pack)}
          risk={risk}
          auditId={audit}
          onApprove={approve}
          onReject={reject}
          approveLabel="Approve and load"
        />
      )}
    </div>
  );
}

function PreviewStats({ preview }: { preview: PackPreview }) {
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Stat label="Accounts" value={preview.accounts} sub={`${preview.paid} paid`} />
        <Stat label="MRR" value={fmtUsd(preview.mrr, 0)} />
        <Stat label="Gross margin" value={fmtPct(preview.marginPct)} />
        <Stat label="Free at a cap" value={preview.freeCapped} sub={`${fmtUsd(preview.breakageUsd, 0)} breakage`} />
      </div>
      <ul className="space-y-1 type-caption text-muted-foreground">
        <li>Maya: {preview.maya}</li>
        <li>Dev: {preview.dev}</li>
      </ul>
    </div>
  );
}
