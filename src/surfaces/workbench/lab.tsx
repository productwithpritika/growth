// Experiment builder and runner (Phase 5 §5.4–5.5): audience, allocation, holdout, minimum
// detectable effect and sample size, mutual-exclusion layers, pre-registered metrics, guardrails
// with a stop-loss and a sample-ratio check. States: draft, approved, running, read-out, shipped
// or killed. D1, D3 and D7 scorecards; ship to 100% needs approval and keeps a revert.
import { skillGateIssues } from "@/platform/gate";
import { useMemo, useState } from "react";
import { FlaskConical, Pause, Plus, Rocket, ShieldAlert, Trash2, Undo2 } from "lucide-react";
import { toast } from "sonner";
import type { ExperimentSpec, LabExperiment } from "@/growth/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { EmptyState } from "@/components/states";
import { ApprovalSheet } from "@/ui/approval-sheet";
import { SectionTitle } from "@/ui/primitives";
import { ToneBadge } from "@/ui/tone";
import { LabScorecard, VERDICT_TONE } from "@/ui/lab-scorecard";
import { useCockpit } from "@/lib/cockpit-store";
import { useWb } from "@/surfaces/workbench/scope";
import { armSize, collisions, INTERVENTIONS, LAYERS, launchIssues, METRICS, monthlyImpact, sampleSize, scorecard, STATUS_LABEL, STATUS_TONE, totals } from "@/growth/lab";
import { approveExperiment, createExperiment, decideExperiment, deleteDraft, launchExperiment, resumeAfterStopLoss, revertExperiment, shipExperiment, updateDraft } from "@/growth/lab-actions";
import { draftFromPick, setTour } from "@/growth/tour";
import { METRIC_BASE, plays, specFromPlay } from "@/growth/ideas";
import { entryPrice, segments } from "@/growth/population";
import { fmtNum, fmtPct, fmtUsd } from "@/core/format";
import { cn } from "@/lib/utils";

export function LabPanel() {
  const { t, run, sandbox, persona } = useWb();
  const sel = useCockpit((s) => s.wbExperiment);
  const setUi = useCockpit((s) => s.setUi);
  const lab = t.growth.lab;
  const e = lab.find((x) => x.id === sel) ?? lab.find((x) => x.status === "running" || x.status === "readout" || x.status === "paused") ?? lab[0] ?? null;
  const owner = persona === "sam" ? "Sam" : "Nia";
  const tour = t.growth.tours[persona];
  const needDraft = sandbox && tour?.picked && !tour.draftId;

  const create = () => {
    const p = plays(t.pack)[0];
    let id = "";
    run((s) => {
      const r = createExperiment(s, { ...specFromPlay(s, p, "manual"), name: "New experiment" }, owner, sandbox);
      id = r.id;
      return r.t;
    }, "Draft created.");
    setUi({ wbExperiment: id || null });
  };

  return (
    <div className="grid gap-6 2xl:grid-cols-[340px_minmax(0,1fr)]">
      <section aria-labelledby="lab-list" className="min-w-0 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <SectionTitle id="lab-list" aside={`${lab.filter((x) => x.status === "running").length} running`}>
            Experiments
          </SectionTitle>
          <Button size="sm" onClick={create}>
            <Plus aria-hidden="true" />
            New experiment
          </Button>
        </div>
        {needDraft && (
          <div className="rounded-xl border border-primary bg-card p-3" data-tour="lab-draft">
            <p className="type-body font-medium">You picked a hypothesis in Ask CB.</p>
            <Button
              size="sm"
              className="mt-2"
              onClick={() => {
                let id = "";
                run((s) => {
                  const r = draftFromPick(s, persona, owner);
                  id = r.id;
                  return setTour(r.t, persona, { draftId: r.id });
                }, "Draft created in the sandbox.");
                setUi({ wbExperiment: id || null });
              }}
            >
              <FlaskConical aria-hidden="true" />
              Draft the experiment from it
            </Button>
          </div>
        )}
        {lab.length === 0 ? (
          <EmptyState title="No experiments yet" description="Pick a hypothesis or a play to start one." />
        ) : (
          <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 2xl:grid-cols-1" aria-label="Experiments">
            {lab.map((x) => {
              const v = x.days.length ? scorecard(x).verdict : null;
              const cur = x.id === e?.id;
              return (
                <li key={x.id} className="min-w-0">
                  <button
                    type="button"
                    aria-current={cur ? "true" : undefined}
                    onClick={() => setUi({ wbExperiment: x.id })}
                    className={cn("w-full rounded-lg border bg-card px-3 py-2 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring", cur ? "border-primary ring-1 ring-primary" : "border-border hover:bg-muted/50")}
                  >
                    <span className="block type-body font-medium">{x.name}</span>
                    <span className="block truncate type-caption text-muted-foreground">
                      {x.audience.label} · {LAYERS.find((l) => l.id === x.layer)?.label ?? x.layer}
                      {x.sandbox ? " · sandbox" : ""}
                    </span>
                    <span className="mt-1 flex flex-wrap items-center gap-1.5">
                      <ToneBadge tone={STATUS_TONE[x.status]}>{STATUS_LABEL[x.status]}</ToneBadge>
                      {x.launchedAt && <span className="type-caption num text-muted-foreground">Day {x.days.length}/7</span>}
                      {v && <ToneBadge tone={VERDICT_TONE[v]}>{v}</ToneBadge>}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>
      <div className="min-w-0">{e ? <Detail key={e.id} e={e} /> : null}</div>
    </div>
  );
}

function Detail({ e }: { e: LabExperiment }) {
  const { t, run, sandbox, persona } = useWb();
  const [sheet, setSheet] = useState<null | "approve" | "ship">(null);
  const [preview, setPreview] = useState(false);
  const editable = e.status === "draft" || e.status === "approved";
  const issues = useMemo(() => launchIssues(e, t.growth.lab, t.pack, skillGateIssues(t, e)), [e, t]);
  const blocks = issues.filter((i) => i.level === "block");
  const tour = t.growth.tours[persona];
  const actor = persona === "sam" ? "Sam" : "Nia";
  const sc = useMemo(() => scorecard(e), [e]);
  const tot = totals(e);
  const price = entryPrice(t.pack);

  const patch = (p: Partial<ExperimentSpec>) => run((s) => updateDraft(s, e.id, p), "", { quiet: true });
  const act = (fn: (s: typeof t) => { t: typeof t; ok: boolean; text: string }) => {
    let res = { ok: false, text: "" };
    run((s) => {
      const r = fn(s);
      res = r;
      return r.t;
    }, "", { quiet: true });
    toast[res.ok ? "success" : "error"](res.text);
    return res.ok;
  };

  const requestApproval = () => {
    if (sandbox && tour) {
      run((s) => setTour(s, persona, { approvalOpen: true, previewed: true }), "", { quiet: true });
      return;
    }
    setSheet("approve");
  };

  return (
    <section aria-labelledby="exp-h" className="space-y-5 rounded-xl border border-border bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 id="exp-h" className="type-heading">
              {e.name}
            </h2>
            <ToneBadge tone={STATUS_TONE[e.status]}>{STATUS_LABEL[e.status]}</ToneBadge>
            {e.sandbox && <ToneBadge tone="info">Sandbox</ToneBadge>}
          </div>
          <p className="type-caption text-muted-foreground">
            {e.owner} · from {e.origin} · {e.launchedAt ? `launched ${new Date(e.launchedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}` : "not launched"}
          </p>
        </div>
        {editable && !e.sandbox && (
          <Button size="sm" variant="ghost" onClick={() => run((s) => deleteDraft(s, e.id), "Draft deleted.")}>
            <Trash2 aria-hidden="true" />
            Delete draft
          </Button>
        )}
      </div>

      {e.status === "paused" && e.pausedReason && (
        <div role="alert" className="rounded-lg border border-blocked bg-blocked-soft p-3 text-blocked-ink">
          <p className="flex items-center gap-2 type-body font-semibold">
            <ShieldAlert aria-hidden="true" className="size-4" />
            Paused automatically by the stop-loss
          </p>
          <p className="type-caption">{e.pausedReason} Exposure stopped; everyone sees the control.</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <Button size="xs" variant="outline" className="bg-background" onClick={() => act((s) => decideExperiment(s, e.id, "Kill", actor))}>
              Kill it
            </Button>
            <Button size="xs" variant="ghost" onClick={() => act((s) => resumeAfterStopLoss(s, e.id, actor, "Guardrail widened after review."))}>
              Resume with a wider guardrail
            </Button>
          </div>
        </div>
      )}

      {editable ? (
        <Builder e={e} patch={patch} />
      ) : (
        <dl className="grid gap-x-6 gap-y-1 type-caption sm:grid-cols-2">
          <Row k="Hypothesis" v={e.hypothesis} />
          <Row k="Variant" v={`${INTERVENTIONS.find((i) => i.id === e.intervention.type)?.label}: ${e.intervention.variant}`} />
          <Row k="Audience" v={`${e.audience.label} · ${fmtNum(e.audience.size)}${e.newCustomersOnly ? " · new customers only" : ""}`} />
          <Row k="Allocation" v={`${Math.round(e.allocation * 100)}% in test, ${Math.round(e.holdout * 100)}% holdout`} />
          <Row k="Primary metric" v={`${e.metric} (pre-registered with ${e.metrics.length - 1} more)`} />
          <Row k="Layer" v={LAYERS.find((l) => l.id === e.layer)?.label ?? e.layer} />
        </dl>
      )}

      {issues.length > 0 && editable && (
        <ul className="space-y-1">
          {issues.map((i) => (
            <li key={i.text} className={cn("rounded-md px-2 py-1.5 type-caption", i.level === "block" ? "bg-blocked-soft text-blocked-ink" : "bg-watch-soft text-watch-ink")}>
              {i.level === "block" ? "Blocks launch: " : "Note: "}
              {i.text}
            </li>
          ))}
        </ul>
      )}

      {editable && (
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="outline"
            aria-expanded={preview || !!tour?.previewed}
            onClick={() => {
              setPreview((v) => !v);
              if (sandbox) run((s) => setTour(s, persona, { previewed: true }), "", { quiet: true });
            }}
            data-tour="scorecard-preview"
          >
            Preview scorecard
          </Button>
          {e.status === "draft" && (
            <Button size="sm" onClick={requestApproval} disabled={blocks.length > 0} data-tour="request-approval">
              Request approval
            </Button>
          )}
          {e.status === "approved" && !e.sandbox && (
            <Button size="sm" onClick={() => act((s) => launchExperiment(s, e.id, actor, persona))}>
              <Rocket aria-hidden="true" />
              Launch
            </Button>
          )}
        </div>
      )}
      {editable && (preview || (sandbox && tour?.previewed && tour.draftId === e.id)) && (
        <section aria-label="Scorecard preview" className="rounded-lg border border-dashed border-border p-3">
          <LabScorecard e={e} preview />
        </section>
      )}

      {e.launchedAt && (
        <>
          <div className="space-y-1">
            <div className="flex items-center justify-between type-caption">
              <span>
                Day {e.days.length} of 7{e.days.length > 7 ? ` (+${e.days.length - 7})` : ""} · {fmtNum(tot.control.exposed + tot.variant.exposed)} exposed of {fmtNum(armSize(e) * 2)}
              </span>
              <span className="text-muted-foreground">Use the Time machine to move the days</span>
            </div>
            <Progress value={Math.min(100, (e.days.length / 7) * 100)} aria-label={`Day ${e.days.length} of 7`} />
          </div>
          <LabScorecard e={e} />
          {(e.status === "readout" || (e.status === "running" && e.days.length >= 7)) && (
            <div className="flex flex-wrap items-center gap-2 rounded-lg bg-muted p-3">
              <span className="type-body font-medium">Decide:</span>
              <Button size="sm" disabled={sc.verdict !== "Ship"} onClick={() => setSheet("ship")}>
                Ship to 100%
              </Button>
              <Button size="sm" variant="outline" onClick={() => act((s) => decideExperiment(s, e.id, "Hold", actor))}>
                <Pause aria-hidden="true" />
                Hold another week
              </Button>
              <Button size="sm" variant="outline" onClick={() => act((s) => decideExperiment(s, e.id, "Kill", actor))}>
                Kill
              </Button>
              <span className="type-caption text-muted-foreground">Estimated impact if shipped: {fmtUsd(monthlyImpact(e, price, sc.decision.find((l) => l.id === "converted")?.at[7]?.lift), 0)} a month</span>
            </div>
          )}
          {e.status === "shipped" && (
            <div className="flex flex-wrap items-center gap-2 rounded-lg bg-healthy-soft p-3 text-healthy-ink">
              <span className="type-body font-medium">Shipped to everyone{e.decision ? ` by ${e.decision.by}` : ""}.</span>
              <Button size="sm" variant="outline" className="bg-background" onClick={() => act((s) => revertExperiment(s, e.id, actor))}>
                <Undo2 aria-hidden="true" />
                Revert
              </Button>
            </div>
          )}
          {e.decision && <p className="type-caption text-muted-foreground">Decision: {e.decision.verdict} by {e.decision.by}. {e.decision.note}</p>}
        </>
      )}

      {sheet && (
        <ApprovalSheet
          open
          onOpenChange={(o) => !o && setSheet(null)}
          title={sheet === "ship" ? `Ship "${e.name}" to 100%` : `Approve "${e.name}"`}
          description={sheet === "ship" ? "Everyone in the audience gets the variant. A revert stays available." : "Approving moves the experiment to Approved; launching starts exposure."}
          preview={
            <div className="space-y-1 type-caption">
              <p>{e.hypothesis}</p>
              {sheet === "ship" ? <p>{sc.reason}</p> : <p>Needs {fmtNum(sampleSize(e.baseRate, e.mde))} users per arm; this audience gives {fmtNum(armSize(e))} in a week.</p>}
            </div>
          }
          diff={
            sheet === "ship"
              ? [{ path: "rollout", before: `${Math.round(e.allocation * 100)}% test`, after: "100% of audience" }, ...e.patches.map((p) => ({ path: p.label, before: String(p.before ?? "—"), after: String(p.after ?? "—") }))]
              : [
                  { path: "status", before: e.status, after: "approved" },
                  { path: "audience", before: "", after: `${e.audience.label} · ${fmtNum(e.audience.size)}` },
                  { path: "guardrails", before: "", after: e.guardrails.map((g) => `${g.label} ≤ ${g.maxWorsePts} pts worse`).join("; ") },
                ]
          }
          risk={{ level: sheet === "ship" ? "medium" : "low", reasons: sheet === "ship" ? ["Applies to the whole audience.", "Revert stays available in the experiment."] : ["Holdout and stop-loss on every guardrail.", `Layer ${e.layer}: ${collisions(e, t.growth.lab).length ? "collides" : "no collisions"}.`] }}
          auditId={`pending · ${e.id}`}
          onApprove={() => {
            const ok = act((s) => (sheet === "ship" ? shipExperiment(s, e.id, actor) : approveExperiment(s, e.id, actor)));
            if (ok) setSheet(null);
          }}
          onReject={() => setSheet(null)}
          approveLabel={sheet === "ship" ? "Approve and ship" : "Approve"}
        />
      )}
    </section>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="py-0.5">
      <dt className="inline font-medium">{k}: </dt>
      <dd className="inline text-muted-foreground">{v}</dd>
    </div>
  );
}

function Builder({ e, patch }: { e: LabExperiment; patch: (p: Partial<ExperimentSpec>) => void }) {
  const { t } = useWb();
  const segs = segments(t);
  const need = sampleSize(e.baseRate, e.mde);
  const have = armSize(e);
  const id = (k: string) => `${e.id}-${k}`;
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1 sm:col-span-2">
          <Label htmlFor={id("name")}>Name</Label>
          <Input id={id("name")} defaultValue={e.name} onBlur={(ev) => ev.target.value.trim() && ev.target.value !== e.name && patch({ name: ev.target.value.trim() })} />
        </div>
        <div className="space-y-1 sm:col-span-2">
          <Label htmlFor={id("hyp")}>Hypothesis</Label>
          <Textarea id={id("hyp")} rows={2} defaultValue={e.hypothesis} onBlur={(ev) => ev.target.value !== e.hypothesis && patch({ hypothesis: ev.target.value })} />
        </div>
        <div className="space-y-1">
          <Label htmlFor={id("type")}>Intervention</Label>
          <NativeSelect id={id("type")} value={e.intervention.type} onChange={(ev) => patch({ intervention: { ...e.intervention, type: ev.target.value as ExperimentSpec["intervention"]["type"] } })}>
            {INTERVENTIONS.map((i) => (
              <NativeSelectOption key={i.id} value={i.id}>
                {i.label}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </div>
        <div className="space-y-1">
          <Label htmlFor={id("variant")}>Variant</Label>
          <Input id={id("variant")} defaultValue={e.intervention.variant} onBlur={(ev) => ev.target.value !== e.intervention.variant && patch({ intervention: { ...e.intervention, variant: ev.target.value } })} />
        </div>
        <div className="space-y-1">
          <Label htmlFor={id("aud")}>Audience</Label>
          <NativeSelect
            id={id("aud")}
            value={e.audience.id}
            onChange={(ev) => {
              const s = segs.find((x) => x.id === ev.target.value) ?? t.growth.audiences.map((a) => ({ id: a.id, label: a.label, size: a.size })).find((x) => x.id === ev.target.value);
              if (s) patch({ audience: { id: s.id, label: s.label, size: s.size } });
            }}
          >
            {!segs.some((s) => s.id === e.audience.id) && <NativeSelectOption value={e.audience.id}>{e.audience.label}</NativeSelectOption>}
            {segs.map((s) => (
              <NativeSelectOption key={s.id} value={s.id}>
                {s.label} ({fmtNum(s.size)})
              </NativeSelectOption>
            ))}
            {t.growth.audiences.map((a) => (
              <NativeSelectOption key={a.id} value={a.id}>
                Saved: {a.label} ({fmtNum(a.size)})
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </div>
        <div className="space-y-1">
          <Label htmlFor={id("layer")}>Mutual-exclusion layer</Label>
          <NativeSelect id={id("layer")} value={e.layer} onChange={(ev) => patch({ layer: ev.target.value })}>
            {LAYERS.map((l) => (
              <NativeSelectOption key={l.id} value={l.id}>
                {l.label}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </div>
        <div className="space-y-1">
          <Label htmlFor={id("alloc")}>Allocation: {Math.round(e.allocation * 100)}% of the audience</Label>
          <input id={id("alloc")} type="range" min={10} max={100} step={5} value={Math.round(e.allocation * 100)} onChange={(ev) => patch({ allocation: Number(ev.target.value) / 100 })} className="w-full accent-[var(--primary)]" />
        </div>
        <div className="space-y-1">
          <Label htmlFor={id("hold")}>Holdout</Label>
          <NativeSelect id={id("hold")} value={String(Math.round(e.holdout * 100))} onChange={(ev) => patch({ holdout: Number(ev.target.value) / 100 })}>
            {[5, 6, 7, 8, 9, 10].map((v) => (
              <NativeSelectOption key={v} value={String(v)}>
                {v}%
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </div>
        <div className="space-y-1">
          <Label htmlFor={id("metric")}>Primary metric</Label>
          <NativeSelect id={id("metric")} value={e.metric} onChange={(ev) => patch({ metric: ev.target.value, baseRate: METRIC_BASE[ev.target.value] ?? e.baseRate, metrics: [ev.target.value, ...e.metrics.filter((m) => m !== ev.target.value)] })}>
            {[...new Set([e.metric, ...METRICS])].map((m) => (
              <NativeSelectOption key={m} value={m}>
                {m}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </div>
        <div className="space-y-1">
          <Label htmlFor={id("mde")}>Minimum detectable effect</Label>
          <NativeSelect id={id("mde")} value={String(Math.round(e.mde * 100))} onChange={(ev) => patch({ mde: Number(ev.target.value) / 100 })}>
            {[5, 8, 10, 15, 20, 30, 50].map((v) => (
              <NativeSelectOption key={v} value={String(v)}>
                {v}% relative lift
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-lg bg-muted p-3">
          <div className="type-caption text-muted-foreground">Sample size per arm</div>
          <div className="type-heading num">{Number.isFinite(need) ? fmtNum(need) : "—"}</div>
          <div className="type-caption text-muted-foreground">at {fmtPct(e.baseRate, 1)} base, 95% confidence, 80% power</div>
        </div>
        <div className="rounded-lg bg-muted p-3">
          <div className="type-caption text-muted-foreground">Users per arm in 7 days</div>
          <div className={cn("type-heading num", have < need ? "text-watch-ink" : "text-healthy-ink")}>{fmtNum(have)}</div>
          <div className="type-caption text-muted-foreground">{have >= need ? "Powered for the D7 read-out" : "Under-powered: D7 reads as directional"}</div>
        </div>
        <div className="rounded-lg bg-muted p-3">
          <div className="type-caption text-muted-foreground">Prior on the lift</div>
          <div className="type-heading num">
            {fmtPct(e.prior[0])}–{fmtPct(e.prior[1])}
          </div>
          <div className="type-caption text-muted-foreground">From the simulator. A prior, not a result.</div>
        </div>
      </div>

      <fieldset className="space-y-2">
        <legend className="type-caption font-semibold">Pre-registered metrics</legend>
        <div className="flex flex-wrap gap-3">
          {METRICS.map((m) => (
            <div key={m} className="flex items-center gap-1.5">
              <Checkbox id={id(`m-${m}`)} checked={e.metrics.includes(m)} disabled={m === e.metric} onCheckedChange={(v) => patch({ metrics: v ? [...e.metrics, m] : e.metrics.filter((x) => x !== m) })} />
              <Label htmlFor={id(`m-${m}`)} className="type-caption font-normal">
                {m}
              </Label>
            </div>
          ))}
        </div>
      </fieldset>

      <fieldset className="space-y-2">
        <legend className="type-caption font-semibold">Guardrails and stop-loss</legend>
        <p className="type-caption text-muted-foreground">Exposure pauses automatically if the variant is worse than control by more than the limit, with enough data and beyond noise.</p>
        <ul className="grid gap-2 sm:grid-cols-2">
          {e.guardrails.map((g) => (
            <li key={g.id} className="flex items-center justify-between gap-2 rounded-md border border-border px-2 py-1.5">
              <Label htmlFor={id(`g-${g.id}`)} className="type-caption font-normal">
                {g.label}
              </Label>
              <span className="flex items-center gap-1 type-caption">
                <Input id={id(`g-${g.id}`)} type="number" min={0.1} step={0.1} className="h-7 w-16" defaultValue={g.maxWorsePts} onBlur={(ev) => Number(ev.target.value) > 0 && patch({ guardrails: e.guardrails.map((x) => (x.id === g.id ? { ...x, maxWorsePts: Number(ev.target.value) } : x)) })} />
                pts
              </span>
            </li>
          ))}
        </ul>
      </fieldset>
    </div>
  );
}
