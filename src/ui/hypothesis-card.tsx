import type { Experiment } from "@/core/types";
import { compareArms } from "@/core/economics";
import { fmtPct } from "@/core/format";
import { Button } from "@/components/ui/button";
import { ToneBadge } from "@/ui/tone";

const STATUS = { draft: { tone: "neutral", label: "Draft" }, running: { tone: "info", label: "Running" }, done: { tone: "healthy", label: "Read out" } } as const;

/** One hypothesis at a glance: status, the bet, the metric and the result so far. */
export function HypothesisCard({ e, cohortLabel, onOpen }: { e: Experiment; cohortLabel: string; onOpen?: () => void }) {
  const c = e.arms.length >= 2 ? compareArms(e.arms[0], e.arms[1]) : null;
  const sig = c && c.pValue < 0.05;
  return (
    <article className="flex h-full flex-col gap-3 rounded-xl border border-border bg-card p-4">
      <div className="flex items-start justify-between gap-2">
        <h3 className="type-heading">{e.name}</h3>
        <ToneBadge tone={STATUS[e.status].tone}>{STATUS[e.status].label}{e.decision ? ` · ${e.decision}` : ""}</ToneBadge>
      </div>
      <p className="type-body text-muted-foreground">{e.hypothesis || "No hypothesis written yet."}</p>
      <dl className="grid grid-cols-2 gap-2 type-caption">
        <div>
          <dt className="text-muted-foreground">Cohort</dt>
          <dd className="font-medium">{cohortLabel}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Metric</dt>
          <dd className="font-medium">{e.metric}</dd>
        </div>
      </dl>
      <div className="mt-auto flex items-end justify-between gap-2">
        <div>
          <div className="type-caption text-muted-foreground">Lift</div>
          <div className="type-title num">{c && c.p1 > 0 ? `${c.lift >= 0 ? "+" : ""}${fmtPct(c.lift)}` : "—"}</div>
          {c && c.p1 > 0 && <div className="type-caption text-muted-foreground">{sig ? "95% interval excludes zero" : "Not yet conclusive"} · p {c.pValue < 0.001 ? "<0.001" : c.pValue.toFixed(3)}</div>}
        </div>
        {onOpen && (
          <Button size="sm" variant="outline" onClick={onOpen}>
            Open
          </Button>
        )}
      </div>
    </article>
  );
}
