// Custom portal experiences (Phase 7 §7.4): describe a moment in plain words, see the Moment
// definition JSON and a plain-language summary side by side, preview it live against real
// accounts and in the Credits Hub, publish behind approval with versions, roll back in one click.
import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Eye, History, RotateCcw, Send, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { SectionTitle } from "@/ui/primitives";
import { ToneBadge } from "@/ui/tone";
import { MomentCard } from "@/ui/moment-card";
import { ApprovalSheet } from "@/ui/approval-sheet";
import { fmtDate } from "@/core/format";
import { useCockpit } from "@/lib/cockpit-store";
import { personaName } from "@/tenants/personas";
import { usePlatform } from "@/surfaces/platform/use-platform";
import { composeMoment, evaluateMoment, EXAMPLE_PROMPT, latestDef, summarise, validateMoment } from "@/platform/moments";
import { draftMoment, previewMoment, publishMoment, reviseMoment, rollbackMoment } from "@/platform/portal-actions";
import type { MomentDef, PortalMoment } from "@/platform/types";

const SUGGESTIONS = [
  EXAMPLE_PROMPT,
  "Show an upgrade card to Launch users when the balance is under 20%, twice a week, as an experiment",
  "When a payment fails, show a billing card to paid users once a day in French",
];

export function ExperiencesPanel() {
  const { t, act, who } = usePlatform();
  const [prompt, setPrompt] = useState(EXAMPLE_PROMPT);
  const composed = useMemo(() => composeMoment(t.pack, prompt), [t.pack, prompt]);
  const moments = t.platform.portal.moments;
  const [sel, setSel] = useState<string | null>(null);
  const cur = moments.find((m) => m.id === sel) ?? moments[0] ?? null;
  const save = () => {
    const r = act((s) => draftMoment(s, prompt, who));
    if (r?.id) setSel(r.id);
  };
  return (
    <div className="space-y-6">
      <section aria-labelledby="cmp-h" className="min-w-0 space-y-3 rounded-xl border border-border bg-card p-4">
        <SectionTitle id="cmp-h" as="h3" aside="The agent composes; a person approves the publish">
          Describe an experience
        </SectionTitle>
        <div className="space-y-1.5">
          <Label htmlFor="mom-prompt">In plain words</Label>
          <Textarea id="mom-prompt" rows={2} value={prompt} onChange={(e) => setPrompt(e.target.value)} />
        </div>
        <div role="group" aria-label="Examples" className="flex flex-wrap gap-1.5">
          {SUGGESTIONS.map((s) => (
            <Button key={s} size="xs" variant="ghost" className="h-auto max-w-full whitespace-normal text-left" onClick={() => setPrompt(s)}>
              {s.length > 64 ? `${s.slice(0, 62)}…` : s}
            </Button>
          ))}
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="min-w-0 space-y-2">
            <div className="type-caption font-semibold">Plain-language summary</div>
            {composed.def ? <p className="type-body">{summarise(t.pack, composed.def)}</p> : null}
            {composed.errors.map((e) => (
              <p key={e} role="alert" className="type-body text-blocked-ink">
                {e}
              </p>
            ))}
            {composed.notes.map((n) => (
              <p key={n} className="type-caption text-muted-foreground">
                {n}
              </p>
            ))}
            {composed.def && <p className="type-caption text-healthy-ink">Valid against the Moment schema.</p>}
          </div>
          <div className="min-w-0 space-y-1">
            <div className="type-caption font-semibold">Moment definition</div>
            <pre aria-label="Moment definition JSON" className="max-h-72 overflow-auto rounded-md bg-muted p-2 font-mono text-xs">{composed.def ? JSON.stringify(composed.def, null, 2) : "—"}</pre>
          </div>
        </div>
        <Button onClick={save} disabled={!composed.def || composed.errors.length > 0}>
          <Sparkles aria-hidden="true" />
          Save as a draft moment
        </Button>
      </section>
      {moments.length > 0 && (
        <div className="grid gap-6 xl:grid-cols-[280px_minmax(0,1fr)]">
          <nav aria-label="Moments" className="space-y-1">
            {moments.map((m) => (
              <button key={m.id} type="button" aria-pressed={cur?.id === m.id} onClick={() => setSel(m.id)} className={`w-full rounded-md px-3 py-2 text-left type-body focus-visible:outline-2 focus-visible:outline-ring ${cur?.id === m.id ? "bg-muted font-semibold" : "hover:bg-muted"}`}>
                {latestDef(m).name}
                <span className="block type-caption font-normal text-muted-foreground">
                  {m.live != null ? `Live v${m.live}` : "Not live"} · {m.versions.length} version{m.versions.length === 1 ? "" : "s"}
                  {m.previewing ? " · previewing" : ""}
                </span>
              </button>
            ))}
          </nav>
          {cur && <MomentDetail m={cur} />}
        </div>
      )}
    </div>
  );
}

function MomentDetail({ m }: { m: PortalMoment }) {
  const { t, act, who } = usePlatform();
  const navigate = useNavigate();
  const setPersona = useCockpit((s) => s.setPersona);
  const setUi = useCockpit((s) => s.setUi);
  const latest = latestDef(m);
  const [words, setWords] = useState(m.prompt);
  const [json, setJson] = useState<string | null>(null);
  const [sheet, setSheet] = useState(false);
  const live = m.live != null ? m.versions.find((v) => v.version === m.live) ?? null : null;
  const jsonText = json ?? JSON.stringify(latest, null, 2);
  const jsonIssues = useMemo(() => {
    try {
      return validateMoment(JSON.parse(jsonText), t.pack);
    } catch {
      return ["Not valid JSON."];
    }
  }, [jsonText, t.pack]);
  const openHub = () => {
    setPersona("dev");
    setUi({ hubTab: "home" });
    navigate("/");
  };
  return (
    <div className="min-w-0 space-y-5">
      <section aria-labelledby="mv-h" className="space-y-3 rounded-xl border border-border bg-card p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 id="mv-h" className="type-heading">{latest.name}</h3>
          <div className="flex flex-wrap items-center gap-2">
            {live ? <ToneBadge tone="healthy">Live v{live.version}</ToneBadge> : <ToneBadge tone="neutral">Not live</ToneBadge>}
            <ToneBadge tone="info">Latest v{latest.version}</ToneBadge>
          </div>
        </div>
        <p className="type-body">{summarise(t.pack, latest)}</p>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => act((s) => previewMoment(s, m.id, !m.previewing, who))} aria-pressed={m.previewing}>
            <Eye aria-hidden="true" />
            {m.previewing ? "Stop preview in Credits Hub" : "Preview in Credits Hub"}
          </Button>
          <Button onClick={() => setSheet(true)} disabled={m.live === latest.version}>
            <Send aria-hidden="true" />
            {m.live === latest.version ? `v${latest.version} is live` : `Ask to publish v${latest.version}`}
          </Button>
          <Button variant="outline" onClick={() => act((s) => rollbackMoment(s, m.id, who))} disabled={m.live == null}>
            <RotateCcw aria-hidden="true" />
            Roll back
          </Button>
          <Button variant="ghost" onClick={openHub}>
            Open Credits Hub as {personaName(t.pack, "dev")}
          </Button>
        </div>
      </section>
      <section aria-labelledby="lp-h" className="space-y-3">
        <SectionTitle id="lp-h" as="h3" aside="Evaluated against the real accounts right now">
          Live preview
        </SectionTitle>
        <div className="grid gap-4 lg:grid-cols-2">
          {(["dev", "maya"] as const).map((acc) => {
            const e = evaluateMoment(t, latest, acc);
            return (
              <div key={acc} className="space-y-2">
                <div className="flex flex-wrap items-center gap-2 type-caption">
                  <span className="font-semibold">{personaName(t.pack, acc)}</span>
                  <ToneBadge tone={e.fires ? "healthy" : "neutral"}>{e.fires ? "Would show now" : e.audience ? "Trigger not met" : "Not in audience"}</ToneBadge>
                </div>
                <div className={e.fires ? "" : "opacity-60"}>
                  <MomentCard tone={latest.tone} trigger={`Custom moment · v${latest.version}`} headline={e.headline} evidence={latest.blocks.find((b) => b.kind === "body")?.text ?? ""} primary={{ label: latest.primaryAction.label, onClick: () => undefined, disabled: true, hint: "Preview only" }} />
                </div>
                <p className="type-caption text-muted-foreground">{e.reason}</p>
              </div>
            );
          })}
        </div>
      </section>
      <div className="grid gap-4 lg:grid-cols-2">
        <section aria-labelledby="ew-h" className="space-y-2 rounded-xl border border-border bg-card p-4">
          <h3 id="ew-h" className="type-body font-semibold">Change it in words</h3>
          <Label htmlFor="mw" className="sr-only">Moment in plain words</Label>
          <Textarea id="mw" rows={3} value={words} onChange={(e) => setWords(e.target.value)} />
          <Button size="sm" variant="outline" onClick={() => act((s) => reviseMoment(s, m.id, { prompt: words }, who))} disabled={words.trim() === m.prompt.trim()}>
            Draft v{latest.version + 1}
          </Button>
        </section>
        <section aria-labelledby="ej-h" className="space-y-2 rounded-xl border border-border bg-card p-4">
          <h3 id="ej-h" className="type-body font-semibold">Or edit the JSON</h3>
          <Label htmlFor="mj" className="sr-only">Moment definition JSON</Label>
          <Textarea id="mj" rows={6} className="font-mono text-xs" value={jsonText} onChange={(e) => setJson(e.target.value)} />
          {json != null && jsonIssues.map((i) => <p key={i} role="alert" className="type-caption text-blocked-ink">{i}</p>)}
          <Button
            size="sm"
            variant="outline"
            disabled={json == null || jsonIssues.length > 0}
            onClick={() => {
              const r = act((s) => reviseMoment(s, m.id, { def: JSON.parse(jsonText) as MomentDef }, who));
              if (r?.ok) setJson(null);
            }}
          >
            Validate and draft v{latest.version + 1}
          </Button>
        </section>
      </div>
      <section aria-labelledby="hist-h" className="space-y-2">
        <h3 id="hist-h" className="type-body font-semibold">
          <History aria-hidden="true" className="mr-1 inline size-4" />
          History
        </h3>
        <ol className="space-y-1 type-caption">
          {[...m.history].reverse().map((h, i) => (
            <li key={i}>
              {fmtDate(h.ts)} · {h.action.replace("-", " ")} v{h.version} · {h.by}
            </li>
          ))}
        </ol>
      </section>
      <ApprovalSheet
        open={sheet}
        onOpenChange={setSheet}
        title={`Publish "${latest.name}" v${latest.version}?`}
        description="Customers in the audience see it in the Credits Hub when the trigger holds. You can roll back in one click."
        preview={<p className="type-body">{summarise(t.pack, latest)}</p>}
        diff={[{ path: `moments.${m.id}.live`, before: m.live == null ? "not live" : `v${m.live}`, after: `v${latest.version}` }]}
        risk={{ level: "low", reasons: ["Content and a link only: no money moves.", `Frequency cap: ${latest.frequencyCap.count} a ${latest.frequencyCap.per}.`] }}
        auditId={`${m.id}-v${latest.version}`}
        onApprove={() => {
          act((s) => publishMoment(s, m.id, latest.version, who));
          setSheet(false);
        }}
        onReject={() => setSheet(false)}
        approveLabel="Approve and publish"
      />
    </div>
  );
}
