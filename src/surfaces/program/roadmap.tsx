// Roadmap page (Phase 8 §8.2, §8.8): three release lanes with templates and gates, every module's
// maturity (tied to the Horizon toggle) and feature flag with percentage rollout and kill switch,
// and the pitch mapping from each presentation question to where it is shown.
import { useState } from "react";
import { ArrowRight, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Range } from "@/ui/range";
import { Checkbox } from "@/components/ui/checkbox";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { SectionTitle } from "@/ui/primitives";
import { ToneBadge } from "@/ui/tone";
import { fmtDate } from "@/core/format";
import { useCockpit } from "@/lib/cockpit-store";
import { atHorizon } from "@/platform/features";
import { advanceRelease, flagOf, gatesDone, MODULES, moduleOf, setFlag, signOff, startRelease, TEMPLATES } from "@/platform/release";
import { usePlatform } from "@/surfaces/platform/use-platform";
import { PITCH, useJump } from "@/components/presenter";

const HZ = { crawl: "Crawl", walk: "Walk", run: "Run" } as const;

export function RoadmapPage() {
  const { t, run, act } = usePlatform();
  const horizon = useCockpit((s) => s.horizon);
  const jump = useJump();
  const [drafts, setDrafts] = useState<Record<number, { title: string; module: string }>>({});
  return (
    <div className="mx-auto max-w-[1440px] space-y-8 px-4 py-5 sm:px-6 sm:py-6">
      <div>
        <h1 className="type-title">Roadmap and release rail</h1>
        <p className="type-body text-muted-foreground">The cadence is part of the product: small changes ship daily inside guardrails, bigger ones every two weeks with sign-off, headline launches every quarter.</p>
      </div>
      <section aria-labelledby="lanes-h" className="space-y-3">
        <SectionTitle id="lanes-h">Release lanes</SectionTitle>
        <div className="grid gap-4 xl:grid-cols-3">
          {[...TEMPLATES].sort((a, b) => b.tier - a.tier).map((tpl) => {
            const rels = t.platform.releases.filter((r) => r.tier === tpl.tier);
            const d = drafts[tpl.tier] ?? { title: tpl.examples[0], module: MODULES[0].key };
            return (
              <div key={tpl.tier} className="space-y-3 rounded-xl border border-border bg-card p-4">
                <div>
                  <h3 className="type-heading">{tpl.label}</h3>
                  <p className="type-caption text-muted-foreground">{tpl.rule}</p>
                  <p className="type-caption">Templates: {tpl.examples.join(", ")}.</p>
                </div>
                <ul className="space-y-2">
                  {rels.map((r) => (
                    <li key={r.id} className="space-y-1.5 rounded-lg border border-border p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="type-body font-medium">{r.title}</span>
                        <ToneBadge tone={r.status === "shipped" ? "healthy" : r.status === "rolling-out" ? "info" : r.status === "in-review" ? "watch" : "neutral"}>{r.status.replace("-", " ")}</ToneBadge>
                      </div>
                      <div className="type-caption text-muted-foreground">
                        {moduleOf(r.module)?.label ?? r.module} · {fmtDate(r.at)} · {r.rollout}% rolled out
                      </div>
                      <div role="img" aria-label={`${r.rollout}% rolled out`} className="h-1.5 rounded-full bg-muted">
                        <div className="h-1.5 rounded-full bg-primary" style={{ width: `${r.rollout}%` }} />
                      </div>
                      {Object.keys(r.signoffs).length > 0 && (
                        <div className="flex flex-wrap gap-3">
                          {tpl.gates.map((g) => (
                            <label key={g.id} className="flex items-center gap-1.5 type-caption">
                              <Checkbox checked={!!r.signoffs[g.id]} disabled={r.status === "shipped"} onCheckedChange={(v) => run((s) => signOff(s, r.id, g.id, !!v), `${g.label} ${v ? "signed" : "withdrawn"}.`, true)} />
                              {g.label}
                            </label>
                          ))}
                        </div>
                      )}
                      {r.status !== "shipped" && (
                        <Button size="xs" variant="outline" onClick={() => act((s) => advanceRelease(s, r.id))} disabled={!gatesDone(r)}>
                          <ArrowRight aria-hidden="true" />
                          {r.rollout < 10 ? "Start rollout at 10%" : r.rollout < 50 ? "Roll out to 50%" : "Ship to 100%"}
                        </Button>
                      )}
                    </li>
                  ))}
                </ul>
                <form
                  className="space-y-2 border-t border-border pt-3"
                  onSubmit={(e) => {
                    e.preventDefault();
                    run((s) => startRelease(s, tpl.tier, d.title, d.module), tpl.tier === 3 ? "Auto-approved inside guardrails: rolling out at 10%." : "Release created. It needs its sign-offs before rollout.");
                  }}
                >
                  <Label htmlFor={`rel-t-${tpl.tier}`} className="type-caption">New {tpl.label.split(" · ")[0]} release</Label>
                  <Input id={`rel-t-${tpl.tier}`} value={d.title} onChange={(e) => setDrafts({ ...drafts, [tpl.tier]: { ...d, title: e.target.value } })} />
                  <NativeSelect aria-label="Module" value={d.module} onChange={(e) => setDrafts({ ...drafts, [tpl.tier]: { ...d, module: e.target.value } })}>
                    {MODULES.map((m) => (
                      <NativeSelectOption key={m.key} value={m.key}>
                        {m.label}
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                  <Button type="submit" size="sm" variant="outline">
                    <Plus aria-hidden="true" />
                    Start release
                  </Button>
                </form>
              </div>
            );
          })}
        </div>
      </section>
      <section aria-labelledby="flags-h" className="space-y-3">
        <SectionTitle id="flags-h" aside={`Horizon now: ${HZ[horizon]}. A module shows when the Horizon reaches its maturity and its flag is not killed.`}>
          Modules, maturity and feature flags
        </SectionTitle>
        <Table>
          <TableCaption className="sr-only">Every module with its maturity, rollout percentage and kill switch</TableCaption>
          <TableHeader>
            <TableRow>
              <TableHead scope="col">Module</TableHead>
              <TableHead scope="col">Maturity</TableHead>
              <TableHead scope="col">Visible now</TableHead>
              <TableHead scope="col" className="min-w-48">Rollout</TableHead>
              <TableHead scope="col">Kill switch</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {MODULES.map((m) => {
              const f = flagOf(t.platform, m.key);
              const hz = atHorizon(horizon, m.key);
              return (
                <TableRow key={m.key}>
                  <TableHead scope="row">
                    {m.label}
                    <span className="block font-mono type-caption font-normal text-muted-foreground">{m.key}</span>
                  </TableHead>
                  <TableCell>
                    <MaturityBadge k={m.key} />
                  </TableCell>
                  <TableCell>{f.killed ? <ToneBadge tone="blocked">Killed</ToneBadge> : hz ? <ToneBadge tone="healthy">Yes</ToneBadge> : <ToneBadge tone="neutral">Later horizon</ToneBadge>}</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-3">
                      <Range aria-label={`Rollout for ${m.label}`} min={0} max={100} step={5} value={f.rollout} onValueChange={(v) => run((s) => setFlag(s, m.key, { rollout: v }), "", true)} className="w-32" />
                      <span className="num w-10 type-caption">{f.rollout}%</span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <Switch aria-label={`Kill ${m.label}`} checked={f.killed} onCheckedChange={(v) => run((s) => setFlag(s, m.key, { killed: v }), v ? `${m.label} killed: hidden everywhere.` : `${m.label} restored.`)} />
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </section>
      <section aria-labelledby="pitch-h" className="space-y-3">
        <SectionTitle id="pitch-h">Pitch mapping</SectionTitle>
        <Table>
          <TableCaption className="sr-only">Presentation questions and where each is shown</TableCaption>
          <TableHeader>
            <TableRow>
              <TableHead scope="col">Presentation question</TableHead>
              <TableHead scope="col">Where it is shown</TableHead>
              <TableHead scope="col"><span className="sr-only">Go</span></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {PITCH.map((p) => (
              <TableRow key={p.q}>
                <TableHead scope="row" className="whitespace-normal">{p.q}</TableHead>
                <TableCell className="whitespace-normal">{p.where}</TableCell>
                <TableCell>
                  <Button size="xs" variant="outline" onClick={() => jump(p.moment)}>
                    Go
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </section>
    </div>
  );
}

function MaturityBadge({ k }: { k: string }) {
  const m = MODULES.find((x) => x.key === k);
  if (!m) return null;
  const h = (["crawl", "walk", "run"] as const).find((x) => atHorizon(x, m.key))!;
  return <ToneBadge tone={h === "crawl" ? "healthy" : h === "walk" ? "info" : "reward"}>{HZ[h]}</ToneBadge>;
}
