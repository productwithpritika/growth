// Cohort Behaviour view (Phase 5 §5.2): a retention heatmap by signup week, sliceable by region,
// plan, acquisition source, account age and behaviour; At risk and Thriving lanes with plain-
// language drivers; what thriving workspaces do differently; and actions that save an audience,
// show revenue at stake, or nudge toward thriving behaviours (a new hypothesis).
import { useMemo, useState, type ReactNode } from "react";
import { BookmarkPlus, FlaskConical, Sprout, TrendingDown, TrendingUp } from "lucide-react";
import type { Segment } from "@/growth/population";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { SectionTitle } from "@/ui/primitives";
import { ToneBadge } from "@/ui/tone";
import { useCockpit } from "@/lib/cockpit-store";
import { useWb } from "@/surfaces/workbench/scope";
import { ALL, growthSim, inSlice, scaleOf, segmentMembers, segments, sliceLabel, sliceOptions, SLICE_DIMS, thrivingBehaviours, weeklyHeatmap, type Slice, type SliceDim } from "@/growth/population";
import { createExperiment, saveAudience } from "@/growth/lab-actions";
import { plays, specFromPlay } from "@/growth/ideas";
import { fmtNum, fmtPct, fmtUsd } from "@/core/format";
import { cn } from "@/lib/utils";

export function CohortsPanel({ usageMap }: { usageMap: ReactNode }) {
  const { t, run, persona } = useWb();
  const segment = useCockpit((s) => s.segment);
  const setUi = useCockpit((s) => s.setUi);
  const [slice, setSlice] = useState<Slice>(ALL);
  const [onlySeg, setOnlySeg] = useState(false);
  const [stake, setStake] = useState(false);
  const sim = useMemo(() => growthSim(t), [t]);
  const segs = useMemo(() => segments(t), [t]);
  const k = scaleOf(t.pack);
  const sel = segs.find((s) => s.id === segment) ?? null;
  const members = useMemo(() => (sel ? new Set(segmentMembers(sim, t.pack, sel.id).map((w) => w.id)) : null), [sim, t.pack, sel]);
  const heat = useMemo(() => weeklyHeatmap(sim, slice, onlySeg && members ? (w) => members.has(w.id) : undefined), [sim, slice, onlySeg, members]);
  const opts = useMemo(() => sliceOptions(sim, t.pack), [sim, t.pack]);
  const thriveId = sel?.lane === "thrive" ? sel.id : "referral-active";
  const effects = useMemo(() => thrivingBehaviours(sim, t.pack, thriveId), [sim, t.pack, thriveId]);
  const owner = persona === "sam" ? "Sam" : "Nia";

  const nudge = () => {
    if (!sel) return;
    const best = [...effects].sort((a, b) => b.effectPts - a.effectPts)[0];
    const p = plays(t.pack).find((x) => x.id === "estimator-first") ?? plays(t.pack)[0];
    const spec = specFromPlay(t, p, "manual");
    let id = "";
    run((s) => {
      const r = createExperiment(s, { ...spec, name: `Nudge toward ${best.label.toLowerCase()}`, hypothesis: `If ${sel.label.toLowerCase()} are nudged to ${best.label.toLowerCase()}, week-4 retention rises (thriving workspaces show ${best.effectPts >= 0 ? "+" : ""}${best.effectPts} points).`, intervention: { type: "nudge-copy", detail: `In-app nudge and e-mail toward ${best.label.toLowerCase()}`, variant: `Nudge: ${best.label}` }, audience: { id: sel.id, label: sel.label, size: sel.size }, layer: "lifecycle", sourceId: `nudge-${best.key}` }, owner, false);
      id = r.id;
      return r.t;
    }, `Draft hypothesis created: nudge toward ${best.label.toLowerCase()}.`);
    setUi({ wbTab: "experiments", wbExperiment: id || null });
  };

  return (
    <div className="space-y-6">
      <p className="type-caption text-muted-foreground">
        Population simulator · {fmtNum(sim.workspaces.length * k)} workspaces (a {fmtNum(sim.workspaces.length)}-workspace sample scaled {k}×) · 90 days to {new Date(sim.anchor).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
      </p>
      <div className="grid gap-6 xl:grid-cols-2">
        <Lane title="At risk" icon={<TrendingDown aria-hidden="true" className="size-4 text-blocked-ink" />} segs={segs.filter((s) => s.lane === "risk")} selected={segment} onPick={(id) => setUi({ segment: id })} />
        <Lane title="Thriving" icon={<TrendingUp aria-hidden="true" className="size-4 text-healthy-ink" />} segs={segs.filter((s) => s.lane === "thrive")} selected={segment} onPick={(id) => setUi({ segment: id })} />
      </div>

      {sel ? (
        <section aria-labelledby="seg-h" className="space-y-3 rounded-xl border border-border bg-card p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 id="seg-h" className="type-heading">
                {sel.label}
              </h2>
              <p className="type-caption text-muted-foreground">{sel.description}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" onClick={() => run((s) => saveAudience(s, sel.id, sel.label, sel.size, sliceLabel(sim, t.pack, slice)), `Saved "${sel.label}" as an audience.`)}>
                <BookmarkPlus aria-hidden="true" />
                Save as audience
              </Button>
              <Button size="sm" variant="outline" aria-expanded={stake} onClick={() => setStake((v) => !v)}>
                Revenue at stake
              </Button>
              <Button size="sm" onClick={nudge}>
                <Sprout aria-hidden="true" />
                Nudge toward thriving behaviours
              </Button>
            </div>
          </div>
          <ul className="list-disc space-y-0.5 pl-5 type-body">
            {sel.drivers.map((d) => (
              <li key={d}>{d}</li>
            ))}
          </ul>
          {stake && (
            <p className="rounded-lg bg-muted p-3 type-body" role="status">
              <span className="font-semibold">{sel.stakeLabel}.</span> {sel.lane === "risk" ? (sel.paid ? "Monthly revenue from workspaces in this cohort that are still paying." : "What the cohort would add if a share of it converted to the entry plan.") : "Monthly revenue this cohort brings today."}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <Button size="xs" variant="ghost" onClick={() => setUi({ askOpen: true, askPrompt: { text: sel.lane === "risk" && sel.id === "free-quiet" ? "Why do quiet free users leave?" : `/cohort ${sel.id}`, via: "chip", n: Date.now() } })}>
              Ask CB about this cohort
            </Button>
            <Button size="xs" variant="ghost" onClick={() => setUi({ wbTab: "plays" })}>
              <FlaskConical aria-hidden="true" />
              Find a play for it
            </Button>
          </div>
        </section>
      ) : (
        <p className="rounded-xl border border-dashed border-border p-4 type-body text-muted-foreground">Select a cohort in either lane to see its drivers and act on it.</p>
      )}

      <section aria-labelledby="heat-h" className="space-y-3">
        <SectionTitle id="heat-h" aside="Share of each signup week still active k weeks later">
          Retention by cohort and week
        </SectionTitle>
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <Label htmlFor="slice-dim" className="type-caption">
              Slice by
            </Label>
            <NativeSelect id="slice-dim" size="sm" value={slice.dim} onChange={(e) => setSlice({ dim: e.target.value as SliceDim, value: e.target.value === "all" ? "all" : opts[e.target.value as SliceDim][0]?.value ?? "all" })}>
              {SLICE_DIMS.map((d) => (
                <NativeSelectOption key={d.id} value={d.id}>
                  {d.label}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </div>
          {slice.dim !== "all" && (
            <div className="space-y-1">
              <Label htmlFor="slice-val" className="type-caption">
                {SLICE_DIMS.find((d) => d.id === slice.dim)?.label}
              </Label>
              <NativeSelect id="slice-val" size="sm" value={slice.value} onChange={(e) => setSlice({ ...slice, value: e.target.value })}>
                {opts[slice.dim].map((o) => (
                  <NativeSelectOption key={o.value} value={o.value}>
                    {o.label}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </div>
          )}
          {sel && (
            <Button size="sm" variant={onlySeg ? "default" : "outline"} aria-pressed={onlySeg} onClick={() => setOnlySeg((v) => !v)}>
              Only {sel.label.toLowerCase()}
            </Button>
          )}
          <span className="type-caption text-muted-foreground">{fmtNum(sim.workspaces.filter((w) => inSlice(sim, w, slice)).length * k)} workspaces in this slice</span>
        </div>
        <div className="overflow-x-auto rounded-xl border border-border bg-card p-3">
          <table className="w-full border-separate border-spacing-1 text-sm">
            <caption className="pb-2 text-left type-caption text-muted-foreground">
              {sliceLabel(sim, t.pack, slice)}
              {onlySeg && sel ? ` · ${sel.label}` : ""}: weekly signup cohorts (rows) by weeks since signup (columns)
            </caption>
            <thead>
              <tr>
                <th scope="col" className="px-2 text-left type-caption font-medium text-muted-foreground">
                  Signed up
                </th>
                <th scope="col" className="px-2 text-right type-caption font-medium text-muted-foreground">
                  Workspaces
                </th>
                {heat.columns.map((c) => (
                  <th key={c} scope="col" className="px-1 text-center type-caption font-medium text-muted-foreground">
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {heat.rows.map((r) => (
                <tr key={r.key}>
                  <th scope="row" className="px-2 text-left font-normal whitespace-nowrap">
                    {r.label}
                  </th>
                  <td className="px-2 text-right num">{fmtNum(r.size * k)}</td>
                  {r.cells.map((v, i) => (
                    <td key={i} className="h-8 min-w-11 rounded-md text-center type-caption font-medium num" style={v == null ? undefined : { background: `color-mix(in oklch, var(--chart-1) ${Math.round(6 + v * 54)}%, var(--card))` }}>
                      {v == null ? "" : fmtPct(v)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section aria-labelledby="thr-h" className="space-y-3">
        <SectionTitle id="thr-h" aside="Associations from the simulator, not causes. Test them before believing them.">
          What thriving workspaces do differently ({segs.find((s) => s.id === thriveId)?.label})
        </SectionTitle>
        <Table>
          <TableCaption className="sr-only">Behaviours with their share in the thriving cohort, the baseline, and the week-4 retention difference</TableCaption>
          <TableHeader>
            <TableRow>
              <TableHead scope="col">Behaviour</TableHead>
              <TableHead scope="col" className="text-right">In cohort</TableHead>
              <TableHead scope="col" className="text-right">Baseline</TableHead>
              <TableHead scope="col" className="text-right">Week-4 retention effect</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {effects.map((e) => (
              <TableRow key={e.key}>
                <TableHead scope="row" className="font-normal">{e.label}</TableHead>
                <TableCell className="text-right num">{fmtPct(e.inSegment)}</TableCell>
                <TableCell className="text-right num">{fmtPct(e.baseline)}</TableCell>
                <TableCell className="text-right">
                  <ToneBadge tone={e.effectPts >= 10 ? "healthy" : e.effectPts >= 0 ? "info" : "watch"}>
                    {e.effectPts >= 0 ? "+" : ""}
                    {e.effectPts} pts
                  </ToneBadge>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </section>

      {t.growth.audiences.length > 0 && (
        <section aria-labelledby="aud-h" className="space-y-2">
          <SectionTitle id="aud-h">Saved audiences</SectionTitle>
          <ul className="flex flex-wrap gap-2">
            {t.growth.audiences.map((a) => (
              <li key={a.id} className="rounded-full border border-border px-3 py-1 type-caption">
                {a.label} · {a.slice} · {fmtNum(a.size)}
              </li>
            ))}
          </ul>
        </section>
      )}

      <Collapsible>
        <CollapsibleTrigger asChild>
          <Button size="sm" variant="ghost" className="h-auto py-1.5 text-left whitespace-normal">
            Usage map and billing-sample cohorts
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent className="mt-3">{usageMap}</CollapsibleContent>
      </Collapsible>
    </div>
  );
}

function Lane({ title, icon, segs, selected, onPick }: { title: string; icon: ReactNode; segs: Segment[]; selected: string; onPick: (id: string) => void }) {
  return (
    <section aria-label={title} className="space-y-2">
      <h2 className="flex items-center gap-2 type-heading">
        {icon}
        {title}
      </h2>
      <ul className="space-y-2">
        {segs.map((s) => {
          const active = s.id === selected;
          return (
            <li key={s.id}>
              <button
                type="button"
                aria-pressed={active}
                onClick={() => onPick(s.id)}
                data-tour={`segment-${s.id}`}
                className={cn("w-full rounded-xl border bg-card p-3 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring", active ? "border-primary ring-1 ring-primary" : "border-border hover:bg-muted/50")}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="type-body font-semibold">{s.label}</span>
                  <span className="flex items-center gap-2">
                    <span className="type-caption num text-muted-foreground">{fmtNum(s.size)} workspaces</span>
                    <ToneBadge tone={s.lane === "risk" ? (s.score >= 70 ? "blocked" : "watch") : "healthy"}>
                      {s.lane === "risk" ? "Risk" : "Score"} {s.score}
                    </ToneBadge>
                  </span>
                </div>
                <ol className="mt-1 list-decimal space-y-0.5 pl-5 type-caption text-muted-foreground">
                  {s.drivers.slice(0, 3).map((d) => (
                    <li key={d}>{d}</li>
                  ))}
                </ol>
                <p className="mt-1 type-caption font-medium">{s.stakeLabel}</p>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export const fmtStake = (n: number) => fmtUsd(n, 0);
