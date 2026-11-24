// The hypothesis engine and the daily experiment (Phase 5 §5.3): three hypotheses a day with a
// fixed anatomy, one recommended with a reason; pick, edit and approve; a Learning library of
// past hypotheses and outcomes. Picking and launching the daily experiment earns CB credits.
import { useMemo, useState } from "react";
import { BookOpen, Check, Rocket } from "lucide-react";
import { toast } from "sonner";
import type { Hypothesis } from "@/growth/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { SectionTitle } from "@/ui/primitives";
import { ToneBadge } from "@/ui/tone";
import { useCockpit } from "@/lib/cockpit-store";
import { useWb } from "@/surfaces/workbench/scope";
import { dailyHypotheses, hypothesisTitle, inFlightSources, specFromHypothesis } from "@/growth/ideas";
import { approveExperiment, createExperiment, launchExperiment, pickHypothesis, recordLearning } from "@/growth/lab-actions";
import { dayOf } from "@/growth/state";
import { fmtNum, fmtPct } from "@/core/format";
import { cn } from "@/lib/utils";

const CONF = { high: "healthy", medium: "info", low: "watch" } as const;
const RISK = { low: "healthy", medium: "watch", high: "blocked" } as const;
const OUT = { shipped: "healthy", killed: "blocked", held: "watch", paused: "watch" } as const;

export function HypothesesPanel() {
  const { t, run, persona, sandbox } = useWb();
  const setUi = useCockpit((s) => s.setUi);
  const day = dayOf(t.clock);
  const picked0 = t.growth.hypotheses.day === day ? t.growth.hypotheses.picked : null;
  const hs = useMemo(() => dailyHypotheses(t, day, inFlightSources(t.growth.lab).filter((id) => id !== picked0)), [t, day, picked0]);
  const picked = t.growth.hypotheses.day === day ? t.growth.hypotheses.picked : null;
  const launched = t.growth.hypotheses.day === day ? t.growth.hypotheses.launched : null;
  const actor = persona === "sam" ? "Sam" : "Nia";
  const [variant, setVariant] = useState<Record<string, string>>({});
  const [title, setTitle] = useState("");
  const [note, setNote] = useState("");

  const approveAndLaunch = (h: Hypothesis) => {
    const base = specFromHypothesis(t, h);
    const spec = { ...base, intervention: { ...base.intervention, variant: variant[h.id] ?? base.intervention.variant } };
    let msg = "";
    let ok = false;
    let id = "";
    run((s) => {
      const c = createExperiment(s, spec, actor, sandbox);
      id = c.id;
      const a = approveExperiment(c.t, c.id, actor);
      if (!a.ok) {
        msg = a.text;
        return c.t;
      }
      const l = launchExperiment(a.t, c.id, actor, persona);
      msg = l.text;
      ok = l.ok;
      return l.ok ? l.t : a.t;
    }, "", { quiet: true });
    toast[ok ? "success" : "error"](msg);
    setUi({ wbTab: "experiments", wbExperiment: id || null });
  };

  return (
    <div className="space-y-6">
      <section aria-labelledby="today-h" className="space-y-3">
        <SectionTitle id="today-h" aside={`${new Date(t.clock).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "short" })} · refreshes each simulated day`}>
          Today's three hypotheses
        </SectionTitle>
        <p className="type-caption text-muted-foreground">Picking and launching today's experiment earns {t.pack.growth.assistant.daily.bonuses.dailyExperiment} CB credits; launching with guardrails earns {t.pack.growth.assistant.daily.bonuses.guardrailLaunch} more.</p>
        <ol className="grid gap-4 xl:grid-cols-3">
          {hs.map((h, i) => {
            const isPicked = picked === h.id;
            return (
              <li key={h.id} className={cn("flex flex-col gap-3 rounded-xl border bg-card p-4", i === 0 ? "border-primary" : "border-border", isPicked && "ring-2 ring-primary")}>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="type-caption font-semibold text-muted-foreground">#{i + 1}</span>
                  <h3 className="type-body font-semibold">{hypothesisTitle(h.id)}</h3>
                  {i === 0 && <ToneBadge tone="reward">Recommended</ToneBadge>}
                </div>
                {i === 0 && <p className="type-caption">{h.why}</p>}
                <dl className="space-y-1 type-caption">
                  <Anatomy k="Observation" v={h.observation} />
                  <Anatomy k="Hypothesis" v={h.hypothesis} />
                  <Anatomy k="Expected effect" v={`+${fmtPct(h.effect[0])} to +${fmtPct(h.effect[1])} (estimate)`} />
                  <Anatomy k="Target metric" v={h.metric} />
                  <Anatomy k="Audience" v={`${h.audience.label} · ${fmtNum(h.audience.size)}`} />
                  <Anatomy k="Intervention" v={h.intervention.detail} />
                  <Anatomy k="Guardrails" v={h.guardrails.join(", ")} />
                </dl>
                <div className="flex flex-wrap gap-1.5">
                  <ToneBadge tone="neutral">Effort {h.effort}</ToneBadge>
                  <ToneBadge tone={RISK[h.risk]}>{h.risk} risk</ToneBadge>
                  <ToneBadge tone={CONF[h.confidence]}>{h.confidence} confidence</ToneBadge>
                </div>
                {isPicked ? (
                  <div className="mt-auto space-y-2 rounded-lg bg-muted p-3">
                    <Label htmlFor={`var-${h.id}`} className="type-caption">
                      Edit the variant before approving
                    </Label>
                    <Input id={`var-${h.id}`} value={variant[h.id] ?? h.intervention.variant} onChange={(e) => setVariant((v) => ({ ...v, [h.id]: e.target.value }))} />
                    <div className="flex flex-wrap gap-2">
                      <Button size="sm" onClick={() => approveAndLaunch(h)} disabled={!!launched}>
                        <Rocket aria-hidden="true" />
                        {launched ? "Launched today" : "Approve and launch"}
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => run((s) => pickHypothesis(s, ""), "", { quiet: true })}>
                        Unpick
                      </Button>
                    </div>
                  </div>
                ) : (
                  <Button size="sm" variant={i === 0 ? "default" : "outline"} className="mt-auto self-start" disabled={!!launched} onClick={() => run((s) => pickHypothesis(s, h.id), `Picked "${hypothesisTitle(h.id)}". Edit it, then approve.`)}>
                    <Check aria-hidden="true" />
                    Pick this one
                  </Button>
                )}
              </li>
            );
          })}
        </ol>
      </section>

      <section aria-labelledby="lib-h" className="space-y-3">
        <SectionTitle id="lib-h" aside={`${t.growth.learnings.length} learnings`}>
          Learning library
        </SectionTitle>
        <ul className="grid gap-3 md:grid-cols-2">
          {t.growth.learnings.map((l) => (
            <li key={l.id} className="space-y-1 rounded-xl border border-border bg-card p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="type-body font-semibold">{l.title}</h3>
                <ToneBadge tone={OUT[l.outcome]}>
                  {l.outcome}
                  {l.lift != null ? ` · ${l.lift >= 0 ? "+" : ""}${fmtPct(l.lift)}` : ""}
                </ToneBadge>
              </div>
              {l.hypothesis && <p className="type-caption text-muted-foreground">{l.hypothesis}</p>}
              <p className="type-caption">{l.note}</p>
              <p className="type-caption text-muted-foreground">{new Date(l.ts).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}</p>
            </li>
          ))}
        </ul>
        <form
          className="grid gap-2 rounded-xl border border-dashed border-border p-3 md:grid-cols-[1fr_2fr_auto] md:items-end"
          onSubmit={(e) => {
            e.preventDefault();
            let text = "";
            run((s) => {
              const r = recordLearning(s, persona, title.trim(), note.trim(), null);
              text = r.text;
              return r.t;
            }, "", { quiet: true });
            toast.success(text);
            setTitle("");
            setNote("");
          }}
        >
          <div className="space-y-1">
            <Label htmlFor="lrn-title">Learning</Label>
            <Input id="lrn-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="What we learned" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="lrn-note">Why it matters</Label>
            <Textarea id="lrn-note" rows={1} value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
          <Button type="submit" disabled={!title.trim() || !note.trim()}>
            <BookOpen aria-hidden="true" />
            Record (+{t.pack.growth.assistant.daily.bonuses.learning} CB credit)
          </Button>
        </form>
      </section>
    </div>
  );
}

function Anatomy({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <dt className="inline font-medium">{k}: </dt>
      <dd className="inline text-muted-foreground">{v}</dd>
    </div>
  );
}
