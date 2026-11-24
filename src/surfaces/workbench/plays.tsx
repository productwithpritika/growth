// Experiment Suggestor (Phase 5 §5.6): twelve plays with simulator-based priors, and a
// dashboard of experiments in flight, win rate, cumulative revenue impact and learning velocity.
import { useMemo } from "react";
import { FlaskConical } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SectionTitle, Stat } from "@/ui/primitives";
import { ToneBadge } from "@/ui/tone";
import { useCockpit } from "@/lib/cockpit-store";
import { useWb } from "@/surfaces/workbench/scope";
import { plays, priorRevenue, specFromPlay } from "@/growth/ideas";
import { createExperiment } from "@/growth/lab-actions";
import { LAYERS, monthlyImpact, scorecard } from "@/growth/lab";
import { entryPrice, segmentById } from "@/growth/population";
import { fmtNum, fmtPct, fmtUsd } from "@/core/format";

export function PlaysPanel() {
  const { t, run, persona, sandbox } = useWb();
  const setUi = useCockpit((s) => s.setUi);
  const ps = useMemo(() => plays(t.pack), [t.pack]);
  const lab = t.growth.lab;
  const inFlight = lab.filter((e) => e.status === "running" || e.status === "paused" || e.status === "readout").length;
  const decided = lab.filter((e) => e.status === "shipped" || e.status === "killed" || e.status === "reverted");
  const wins = decided.filter((e) => e.status === "shipped").length;
  const price = entryPrice(t.pack);
  const impact = lab.filter((e) => e.status === "shipped").reduce((s, e) => s + monthlyImpact(e, price, scorecard(e).decision.find((l) => l.id === "converted")?.at[7]?.lift), 0);
  const since = new Date(t.clock).getTime() - 30 * 86_400_000;
  const recent = t.growth.learnings.filter((l) => new Date(l.ts).getTime() >= since).length;
  const owner = persona === "sam" ? "Sam" : "Nia";

  const use = (id: string) => {
    const p = ps.find((x) => x.id === id)!;
    let eid = "";
    run((s) => {
      const r = createExperiment(s, specFromPlay(s, p), owner, sandbox);
      eid = r.id;
      return r.t;
    }, `"${p.title}" drafted. Review it, then request approval.`);
    setUi({ wbTab: "experiments", wbExperiment: eid || null });
  };

  return (
    <div className="space-y-6">
      <section aria-labelledby="dash-h" className="space-y-3">
        <SectionTitle id="dash-h">Experiment dashboard</SectionTitle>
        <div className="grid grid-cols-2 gap-4 rounded-xl border border-border bg-card p-4 md:grid-cols-4">
          <Stat label="In flight" value={fmtNum(inFlight)} sub={`${lab.filter((e) => e.status === "draft" || e.status === "approved").length} drafts waiting`} />
          <Stat label="Win rate" value={decided.length ? fmtPct(wins / decided.length) : "—"} sub={`${wins} shipped of ${decided.length} decided`} />
          <Stat label="Cumulative revenue impact" value={fmtUsd(impact, 0)} sub="a month, from shipped tests (estimate)" />
          <Stat label="Learning velocity" value={`${(recent / 4.3).toFixed(1)} / week`} sub={`${recent} learnings in 30 days`} />
        </div>
      </section>

      <section aria-labelledby="plays-h" className="space-y-3">
        <SectionTitle id="plays-h" aside="Ranges are priors from the population simulator, not results">
          Plays for {t.pack.company}
        </SectionTitle>
        <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {ps.map((p) => {
            const [lo, hi] = priorRevenue(t, p);
            const seg = segmentById(t, p.audience);
            return (
              <li key={p.id} className="flex flex-col gap-2 rounded-xl border border-border bg-card p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="type-body font-semibold">{p.title}</h3>
                  {p.needsEvals && <ToneBadge tone="watch">Needs evals (Phase 6)</ToneBadge>}
                </div>
                <p className="type-caption">{p.pitch}</p>
                <p className="type-caption text-muted-foreground">{p.basis(t)}</p>
                <dl className="grid grid-cols-2 gap-x-3 gap-y-0.5 type-caption">
                  <dt className="text-muted-foreground">Audience</dt>
                  <dd>
                    {seg?.label ?? p.audience} · {fmtNum(seg?.size ?? 0)}
                  </dd>
                  <dt className="text-muted-foreground">Metric</dt>
                  <dd>{p.metric}</dd>
                  <dt className="text-muted-foreground">Layer</dt>
                  <dd>{LAYERS.find((l) => l.id === p.layer)?.label}</dd>
                  <dt className="text-muted-foreground">Lift prior</dt>
                  <dd>
                    +{fmtPct(p.prior[0])} to +{fmtPct(p.prior[1])}
                  </dd>
                </dl>
                <p className="mt-auto type-body">
                  <span className="font-semibold num">
                    {fmtUsd(lo, 0)}–{fmtUsd(hi, 0)}
                  </span>{" "}
                  <span className="type-caption text-muted-foreground">a month</span> <ToneBadge tone="neutral">Prior</ToneBadge>
                </p>
                <Button size="sm" variant="outline" className="self-start" onClick={() => use(p.id)}>
                  <FlaskConical aria-hidden="true" />
                  Use this play
                </Button>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
