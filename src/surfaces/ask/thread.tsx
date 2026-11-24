// One Ask CB conversation: the merchant assistant (Nia, Sam) or the end-user Credits assistant
// (Maya, Dev, a Member). Same engine, different scope. Answer first, then evidence, confidence,
// Memory cards used and next-action chips; Show my work reveals the tool calls; writes go
// through the ApprovalSheet and the audit log.
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Mic, MicOff, Plus, SendHorizonal, Sparkles, Volume2, Wand2 } from "lucide-react";
import type { TenantState } from "@/core/types";
import type { CbMessage, CbModelId, CbScope, CbThread, Chip, HypothesisLite, WriteProposal } from "@/growth/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { ApprovalSheet } from "@/ui/approval-sheet";
import { ToolCallTrace } from "@/ui/tool-call-trace";
import { ToneBadge } from "@/ui/tone";
import { AnswerBlock, type BlockActions } from "@/surfaces/ask/blocks";
import { shortAnswer, speak, speechSupport, stopSpeaking, useVoice } from "@/surfaces/ask/voice";
import { applyWrite, argChips, ask, commandPreview, commandsFor, newThread, parseCommand, research, type AskEnv, type Horizon } from "@/agents/cb/engine";
import { askMessage } from "@/agents/ask-cb";
import { chat } from "@/agents/llm-gateway";
import { buyCb, cbAllowance, gid, spendCb, track } from "@/growth/state";
import { setTour } from "@/growth/tour";
import { REGIONS } from "@/tenants/regions";
import { fmtUsd } from "@/core/format";
import { personaName, type PersonaId } from "@/tenants/personas";
import { cn } from "@/lib/utils";

export type ThreadRun = (fn: (s: TenantState) => TenantState, okText: string, opts?: { quiet?: boolean }) => boolean;

export interface AskThreadProps {
  scope: CbScope;
  persona: string;
  account: "maya" | "dev" | null;
  member: string | null;
  t: TenantState;
  getT: () => TenantState;
  run: ThreadRun;
  sandbox: boolean;
  horizon: Horizon;
  threadId: string | null;
  onThread: (id: string | null) => void;
  onTab?: (tab: string) => void;
  incoming?: { text: string; via: CbMessage["via"]; n: number } | null;
  compact?: boolean;
  starters?: string[];
}

const CONF_TONE = { high: "healthy", medium: "info", low: "watch" } as const;
const STATUS: Partial<Record<NonNullable<CbMessage["status"]>, { tone: "watch" | "blocked" | "neutral" | "info"; label: string }>> = {
  declined: { tone: "neutral", label: "Declined" },
  clarify: { tone: "info", label: "Needs one answer" },
  empty: { tone: "neutral", label: "No results" },
  error: { tone: "blocked", label: "Tool error" },
  timeout: { tone: "watch", label: "Timed out" },
  "rate-limited": { tone: "watch", label: "Rate limited" },
  "out-of-credits": { tone: "watch", label: "Out of CB credits" },
};

function upsert(s: TenantState, th: CbThread): TenantState {
  return { ...s, growth: { ...s.growth, ask: { ...s.growth.ask, threads: [th, ...s.growth.ask.threads.filter((x) => x.id !== th.id)].slice(0, 30) } } };
}

export function AskThread(p: AskThreadProps) {
  const { t, scope, persona, run, sandbox } = p;
  const thread = useMemo(() => t.growth.ask.threads.find((x) => x.id === p.threadId && x.scope === scope && x.persona === persona) ?? null, [t, p.threadId, scope, persona]);
  const [input, setInput] = useState("");
  const [thinking, setThinking] = useState(false);
  const [work, setWork] = useState<Record<string, boolean>>({});
  const [approval, setApproval] = useState<{ msg: CbMessage; w: WriteProposal } | null>(null);
  const [speakOn, setSpeakOn] = useState(false);
  const [handsFree, setHandsFree] = useState(false);
  const [live, setLive] = useState("");
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const lastIncoming = useRef(0);
  const support = speechSupport();
  const company = t.pack.company;
  const models = t.pack.growth.assistant.models;
  const allowance = scope === "merchant" && !sandbox ? cbAllowance(t, persona) : null;
  const reduced = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

  const env = (via: CbMessage["via"]): AskEnv => ({ persona, scope, account: p.account, member: p.member, sandbox, regions: REGIONS, horizon: p.horizon, via });

  const send = (raw: string, via: CbMessage["via"] = "typed", opts: { model?: CbModelId } = {}) => {
    const text = raw.trim();
    if (!text || thinking) return;
    stopSpeaking();
    const at = new Date().toISOString();
    const base = thread ?? newThread(scope, persona, p.getT().clock, sandbox);
    const user: CbMessage = { id: gid("msg", at), role: "user", ts: at, text, via, command: parseCommand(text)?.name };
    const th: CbThread = { ...base, model: opts.model ?? base.model, title: base.messages.length ? base.title : text.slice(0, 60), messages: [...base.messages, user] };
    run((s) => upsert(s, th), "", { quiet: true });
    p.onThread(th.id);
    setInput("");
    setThinking(true);
    setLive("Ask CB is working on it.");
    window.setTimeout(
      () => {
        const fresh = p.getT();
        const cur = fresh.growth.ask.threads.find((x) => x.id === th.id) ?? th;
        const r = cur.mode === "research" && scope === "merchant" ? research(fresh, env(via), cur, text) : ask(fresh, env(via), cur, text);
        let next = r.t;
        let msg = r.message;
        if (msg.write?.status === "auto") {
          const out = applyWrite(next, persona, th.id, msg.id, msg.write, "auto");
          next = out.t;
          msg = { ...msg, write: { ...msg.write, auditId: out.auditId } };
          toast.success(`${out.text} Auto-approved within budget.`);
        }
        const thNow = next.growth.ask.threads.find((x) => x.id === th.id) ?? cur;
        next = upsert(next, { ...thNow, messages: [...thNow.messages, msg] });
        run(() => next, "", { quiet: true });
        setThinking(false);
        setLive(`Answer: ${shortAnswer(msg.text)}`);
        if (speakOn || via === "voice") speak(shortAnswer(msg.text));
        if (msg.write?.status === "proposed") setApproval({ msg, w: msg.write });
        if (r.unmatched && scope === "merchant" && !sandbox && fresh.growth.ask.provider === "live") void askLive(th.id, text);
      },
      reduced ? 120 : 650,
    );
  };

  const askLive = async (threadId: string, text: string) => {
    setThinking(true);
    const at = new Date().toISOString();
    try {
      const ans = await chat(askMessage(p.getT(), text));
      const msg: CbMessage = { id: gid("msg", at), role: "assistant", ts: at, text: ans.message?.trim() || "The live model returned an empty answer.", status: ans.message ? "ok" : "empty", model: "deep", live: true, cost: allowance ? 1 : 0, task: "analysis", confidence: "low", evidence: ["Answered by the live model from the cockpit snapshot. Numbers are not verified against the scripted library."] };
      run((s) => {
        let n = allowance ? spendCb(s, persona, 1, "live", threadId) : s;
        const th = n.growth.ask.threads.find((x) => x.id === threadId);
        if (th) n = upsert(n, { ...th, messages: [...th.messages, msg] });
        return n;
      }, "", { quiet: true });
    } catch {
      const msg: CbMessage = { id: gid("msg", at), role: "assistant", ts: at, text: "The live model didn't respond, so there's no answer. Nothing was charged. Switch the provider back to Scripted or try again.", status: "error", cost: 0 };
      run((s) => {
        const th = s.growth.ask.threads.find((x) => x.id === threadId);
        return th ? upsert(s, { ...th, messages: [...th.messages, msg] }) : s;
      }, "", { quiet: true });
    } finally {
      setThinking(false);
    }
  };

  const voice = useVoice((text) => send(text, "voice"));

  const sendRef = useRef(send);
  useEffect(() => {
    sendRef.current = send;
  });
  const incoming = p.incoming;
  useEffect(() => {
    if (incoming && incoming.n !== lastIncoming.current) {
      lastIncoming.current = incoming.n;
      sendRef.current(incoming.text, incoming.via);
    }
  }, [incoming]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: reduced ? "auto" : "smooth" });
  }, [thread?.messages.length, thinking, reduced]);

  const setModel = (m: CbModelId) => {
    const th = thread ?? newThread(scope, persona, t.clock, sandbox);
    run((s) => upsert(s, { ...th, model: m }), "", { quiet: true });
    p.onThread(th.id);
  };
  const setMode = (mode: CbThread["mode"]) => {
    const th = thread ?? newThread(scope, persona, t.clock, sandbox);
    run((s) => upsert(s, { ...th, mode }), "", { quiet: true });
    p.onThread(th.id);
  };

  const decide = (msg: CbMessage, w: WriteProposal, decision: "approved" | "rejected") => {
    const th = thread;
    if (!th) return;
    let text = "";
    let ok = true;
    run((s) => {
      const out = applyWrite(s, persona, th.id, msg.id, w, decision);
      text = out.text;
      ok = out.ok;
      const cur = out.t.growth.ask.threads.find((x) => x.id === th.id);
      const n = cur ? upsert(out.t, { ...cur, messages: cur.messages.map((m) => (m.id === msg.id && m.write ? { ...m, write: { ...m.write, status: decision === "approved" ? "approved" : "rejected", auditId: out.auditId } } : m)) }) : out.t;
      return { ...n, growth: track(n.growth, { ts: new Date().toISOString(), sim: null, session: th.id, persona, kind: "ask", name: `write.${decision}`, detail: w.title }) };
    }, "", { quiet: true });
    setApproval(null);
    if (decision === "approved") toast[ok ? "success" : "error"](text || "Done.");
    else toast("Rejected. Nothing changed.");
  };

  const onChip = (c: Chip, msg: CbMessage) => {
    if (c.action === "wait") {
      const hrs = 24 - Number(t.clock.slice(11, 13));
      toast(`CB credits reset at midnight, in about ${hrs} hours. In this demo, the Time machine moves the clock.`);
      return;
    }
    const lastUser = [...(thread?.messages ?? [])].reverse().find((m) => m.role === "user" && m.ts <= msg.ts);
    if (c.action === "lite") {
      if (lastUser) send(lastUser.text, "chip", { model: "lite" });
      return;
    }
    if (c.action === "buy") {
      run((s) => buyCb(s, persona), `${t.pack.growth.assistant.daily.pack.credits} CB credits added for ${fmtUsd(t.pack.growth.assistant.daily.pack.price)}.`);
      if (lastUser) window.setTimeout(() => send(lastUser.text, "chip"), 50);
      return;
    }
    if (c.tab && p.onTab) {
      run((s) => ({ ...s, growth: track(s.growth, { ts: new Date().toISOString(), sim: null, session: thread?.id ?? "", persona, kind: "click", name: `open.${c.tab}`, detail: "from Ask CB" }) }), "", { quiet: true });
      p.onTab(c.tab);
      return;
    }
    if (c.prompt) send(c.prompt, "chip");
  };

  // Slash autocomplete
  const cmd = input.startsWith("/") ? input.slice(1) : null;
  const cmdName = cmd?.split(/\s/)[0] ?? "";
  const menu = cmd != null && !/\s/.test(cmd) ? commandsFor(scope, p.horizon).filter((c) => c.name.startsWith(cmdName.toLowerCase())) : [];
  const parsed = parseCommand(input);
  const chips = parsed && /\s/.test(input) ? argChips(t, scope, p.account, parsed.name, REGIONS).filter((a) => !parsed.args.join(" ") || a.startsWith(parsed.args.join(" "))) : [];
  const preview = input.startsWith("/") ? commandPreview(t, scope, input) : "";

  const actionsFor = (msg: CbMessage): BlockActions => {
    const tour = t.growth.tours[persona];
    return {
      sandbox,
      picked: sandbox ? (tour?.picked ?? null) : null,
      onPick: sandbox ? (h: HypothesisLite) => run((s) => setTour(s, persona, { picked: h.id }), `Picked "${h.title}".`) : undefined,
      onDraft: !sandbox && scope === "merchant" ? (h: HypothesisLite) => send(`Draft an experiment for "${h.title}"`, "chip") : undefined,
      onSave:
        scope === "merchant" && !sandbox
          ? (sections, plan) =>
              run((s) => ({ ...s, growth: { ...s.growth, playbook: [{ id: gid("pb", s.clock), ts: s.clock, title: [...(thread?.messages ?? [])].reverse().find((m) => m.role === "user" && m.ts <= msg.ts)?.text ?? "Research brief", question: plan[0] ?? "", sections, by: persona }, ...s.growth.playbook] } }), "Saved to the Playbook.")
          : undefined,
      saved: false,
      onCommand: (name) => {
        setInput(`${name} `);
        inputRef.current?.focus();
      },
    };
  };

  const empty = !thread || thread.messages.length === 0;
  const modelName = (id?: string) => models.find((m) => m.id === id)?.name ?? id ?? "";

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2">
        <Label htmlFor={`model-${persona}`} className="sr-only">
          Model
        </Label>
        <NativeSelect id={`model-${persona}`} size="sm" value={thread?.model ?? "auto"} onChange={(e) => setModel(e.target.value as CbModelId)} aria-label="Model for this conversation">
          <NativeSelectOption value="auto">Auto · picks per question</NativeSelectOption>
          {models.map((m) => (
            <NativeSelectOption key={m.id} value={m.id}>
              {m.name} · {m.speed} · {m.depth} · {m.free ? "free" : `${m.relCost} cost`}
            </NativeSelectOption>
          ))}
        </NativeSelect>
        {scope === "merchant" && (
          <div className="flex items-center gap-1.5">
            <Switch id={`research-${persona}`} checked={thread?.mode === "research"} onCheckedChange={(v) => setMode(v ? "research" : "chat")} />
            <Label htmlFor={`research-${persona}`} className="type-caption">
              Research analyst
            </Label>
          </div>
        )}
        <span className="ml-auto type-caption text-muted-foreground" aria-live="polite">
          {sandbox ? "Sandbox · no CB credits used" : allowance ? `${allowance.remaining} CB credit${allowance.remaining === 1 ? "" : "s"} left today` : `Included with ${company}`}
        </span>
        <Button size="icon-sm" variant="ghost" aria-label="New conversation" onClick={() => p.onThread(null)}>
          <Plus aria-hidden="true" />
        </Button>
      </div>

      <div ref={listRef} className="min-h-0 flex-1 space-y-4 overflow-y-auto px-3 py-3" role="log" aria-label="Conversation" aria-busy={thinking}>
        {empty && (
          <div className="space-y-3 py-4">
            <p className="type-body font-medium">{scope === "merchant" ? `Ask about ${company}'s cohorts, experiments, credits and margins.` : "Ask about your balance, forecast and runs. I only see your own workspace."}</p>
            <p className="type-caption text-muted-foreground">Type / for commands. Every answer shows its evidence; changes need your approval.</p>
            <div className="flex flex-wrap gap-2">
              {(p.starters ?? []).map((s) => (
                <Button key={s} size="xs" variant="outline" className="h-auto py-1 text-left whitespace-normal" onClick={() => send(s, "chip")}>
                  {s}
                </Button>
              ))}
            </div>
          </div>
        )}
        {thread?.messages.map((m) =>
          m.role === "user" ? (
            <div key={m.id} className="flex justify-end">
              <div className="max-w-[85%] rounded-2xl rounded-br-sm bg-primary px-3 py-2 text-primary-foreground type-body">
                {m.via === "voice" && <Mic aria-label="Spoken" className="mr-1 inline size-3.5" />}
                {m.text}
              </div>
            </div>
          ) : (
            <article key={m.id} className="space-y-2" aria-label="Ask CB answer">
              <div className="flex flex-wrap items-center gap-2 type-caption text-muted-foreground">
                <Sparkles aria-hidden="true" className="size-3.5 text-primary" />
                <span className="font-medium text-foreground">{m.live ? "Live model" : modelName(m.model)}</span>
                {m.autoReason && <span>{m.autoReason}</span>}
                {m.status && STATUS[m.status] && <ToneBadge tone={STATUS[m.status]!.tone}>{STATUS[m.status]!.label}</ToneBadge>}
              </div>
              <p className="type-body font-medium">{m.text}</p>
              {m.status === "out-of-credits" && (
                <div className="rounded-lg border border-watch bg-watch-soft p-3">
                  <p className="type-caption font-semibold text-watch-ink">CB Daily 5 is used up for today</p>
                  <p className="type-caption text-watch-ink">Chargebee gives every merchant user 5 free CB credits a day, plus bonuses for launching with guardrails and recording learnings. Pick one:</p>
                </div>
              )}
              {m.blocks?.map((b, i) => (
                <AnswerBlock key={i} b={b} t={t} idx={`${m.id}-${i}`} actions={actionsFor(m)} />
              ))}
              {m.clarify && (
                <div className="rounded-lg border border-info bg-info-soft p-3">
                  <p className="type-caption font-semibold text-info-ink">{m.clarify.question}</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {m.clarify.options.map((o) => (
                      <Button key={o.label} size="xs" variant="outline" className="h-auto py-1 text-left whitespace-normal" onClick={() => onChip(o, m)}>
                        {o.label}
                      </Button>
                    ))}
                  </div>
                </div>
              )}
              {m.evidence && m.evidence.length > 0 && (
                <div>
                  <h4 className="type-caption font-semibold uppercase tracking-wide text-muted-foreground">Evidence</h4>
                  <ul className="mt-1 list-disc space-y-0.5 pl-5 type-caption">
                    {m.evidence.map((e) => (
                      <li key={e}>{e}</li>
                    ))}
                  </ul>
                </div>
              )}
              {(m.confidence || (m.cites && m.cites.length > 0)) && (
                <div className="flex flex-wrap items-center gap-2 type-caption">
                  {m.confidence && <ToneBadge tone={CONF_TONE[m.confidence]}>{m.confidence} confidence</ToneBadge>}
                  {m.cites && m.cites.length > 0 && (
                    <span className="text-muted-foreground">
                      Memory used: {m.cites.map((id) => t.growth.memory.find((c) => c.id === id)?.title ?? id).join(", ")}
                    </span>
                  )}
                </div>
              )}
              {m.write && <WriteCard w={m.write} sandbox={sandbox} onOpen={() => setApproval({ msg: m, w: m.write! })} />}
              {m.chips && m.chips.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {m.chips.map((c) => (
                    <Button key={c.label} size="xs" variant={c.action ? "default" : "outline"} className="h-auto py-1 text-left whitespace-normal" onClick={() => onChip(c, m)}>
                      {c.label}
                    </Button>
                  ))}
                </div>
              )}
              <div className="flex flex-wrap items-center gap-3 type-caption text-muted-foreground">
                <span>{sandbox ? "Sandbox · no CB credits used" : scope === "enduser" ? `Included with ${company}` : m.cost ? `Used ${m.cost} CB credit${m.cost === 1 ? "" : "s"}` : "No CB credits used"}</span>
                {m.trace && m.trace.length > 0 && (
                  <span className="flex items-center gap-1.5">
                    <Switch id={`work-${m.id}`} checked={!!work[m.id]} onCheckedChange={(v) => setWork((w) => ({ ...w, [m.id]: v }))} />
                    <Label htmlFor={`work-${m.id}`} className="type-caption font-normal">
                      Show my work
                    </Label>
                  </span>
                )}
              </div>
              {work[m.id] && m.trace && <ToolCallTrace calls={m.trace} />}
            </article>
          ),
        )}
        {thinking && (
          <p className="flex items-center gap-2 type-caption text-muted-foreground">
            <Wand2 aria-hidden="true" className="size-3.5 animate-pulse motion-reduce:animate-none" />
            Working on it…
          </p>
        )}
      </div>

      <div className="relative border-t border-border p-3">
        {menu.length > 0 && (
          <ul id={`cmds-${persona}`} aria-label="Slash commands" className="absolute right-3 bottom-full left-3 mb-1 max-h-60 overflow-y-auto rounded-lg border border-border bg-popover p-1 shadow-md">
            {menu.map((c, i) => (
              <li key={c.name}>
                <button
                  type="button"
                  onClick={() => {
                    setInput(`/${c.name}${c.args ? " " : ""}`);
                    inputRef.current?.focus();
                  }}
                  className={cn("w-full cursor-pointer rounded-md px-2 py-1.5 text-left type-caption hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring", i === 0 && "bg-muted/60")}
                >
                  <span className="font-mono font-medium">
                    /{c.name} {c.args}
                  </span>
                  <span className="ml-2 text-muted-foreground">{c.help}</span>
                  {c.write && <span className="ml-2 text-watch-ink">· needs approval</span>}
                </button>
              </li>
            ))}
          </ul>
        )}
        {(chips.length > 0 || preview) && (
          <div className="mb-2 space-y-1">
            {chips.length > 0 && (
              <div className="flex flex-wrap gap-1" aria-label="Arguments">
                {chips.slice(0, 8).map((a) => (
                  <Button key={a} size="xs" variant="outline" onClick={() => setInput(`/${parsed!.name} ${a}`)}>
                    {a}
                  </Button>
                ))}
              </div>
            )}
            {preview && (
              <p id={`preview-${persona}`} className="type-caption text-muted-foreground">
                {preview}
              </p>
            )}
          </div>
        )}
        {(voice.listening || voice.transcript) && (
          <p className="mb-2 rounded-md bg-muted px-2 py-1 type-caption" aria-live="polite">
            {voice.listening ? "Listening… " : "Heard: "}
            {voice.transcript || "…"}
          </p>
        )}
        {voice.error && (
          <p role="alert" className="mb-2 type-caption text-watch-ink">
            {voice.error}
          </p>
        )}
        <form
          className="flex items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            const only = menu.length === 1 && `/${menu[0].name}` !== input.trim() ? menu[0] : null;
            if (only && only.args) {
              setInput(`/${only.name} `);
              return;
            }
            send(only ? `/${only.name}` : input);
          }}
        >
          <Label htmlFor={`ask-input-${persona}`} className="sr-only">
            Message Ask CB
          </Label>
          <Input
            ref={inputRef}
            id={`ask-input-${persona}`}
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
              if (e.target.value) stopSpeaking();
            }}
            placeholder={scope === "merchant" ? "Ask CB, or type / for commands" : "Ask about your credits, or type /"}
            className="h-10"
            autoComplete="off"
            aria-controls={menu.length ? `cmds-${persona}` : undefined}
            aria-describedby={preview ? `preview-${persona}` : undefined}
            data-tour="ask-input"
          />
          <Button
            type="button"
            size="icon"
            variant={voice.listening === "ptt" ? "default" : "outline"}
            aria-label={voice.listening ? "Stop listening" : "Push to talk"}
            aria-pressed={!!voice.listening}
            onClick={() => (voice.listening ? voice.stop() : voice.start(handsFree ? "hands-free" : "ptt"))}
          >
            {voice.listening ? <MicOff aria-hidden="true" /> : <Mic aria-hidden="true" />}
          </Button>
          <Button type="submit" size="icon" aria-label="Send" disabled={!input.trim() || thinking}>
            <SendHorizonal aria-hidden="true" />
          </Button>
        </form>
        <div className="mt-2 flex flex-wrap items-center gap-4 type-caption text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <Switch id={`hf-${persona}`} checked={handsFree} disabled={!support.listen} onCheckedChange={setHandsFree} />
            <Label htmlFor={`hf-${persona}`} className="type-caption font-normal">
              Hands-free
            </Label>
          </span>
          <span className="flex items-center gap-1.5">
            <Switch id={`tts-${persona}`} checked={speakOn} disabled={!support.speak} onCheckedChange={(v) => {
                setSpeakOn(v);
                if (!v) stopSpeaking();
              }} />
            <Label htmlFor={`tts-${persona}`} className="flex items-center gap-1 type-caption font-normal">
              <Volume2 aria-hidden="true" className="size-3.5" />
              Read answers aloud
            </Label>
          </span>
          {!support.listen && <span>Voice input isn't available here; typing works everywhere.</span>}
        </div>
        <p className="sr-only" role="status" aria-live="polite">
          {live}
        </p>
      </div>

      {approval && (
        <ApprovalSheet
          open
          onOpenChange={(o) => !o && setApproval(null)}
          title={approval.w.title}
          description={`${approval.w.summary} Requested in Ask CB by ${personaName(t.pack, persona as PersonaId)}. Voice can't approve: tap Approve.`}
          preview={
            <div className="space-y-1 type-body">
              <p>{approval.w.summary}</p>
              <p className="type-caption text-muted-foreground">Estimated cost {fmtUsd(approval.w.costUsd)} · workflow {approval.w.workflow} · autonomy {t.growth.autonomy[approval.w.workflow]}</p>
            </div>
          }
          diff={approval.w.diff}
          risk={approval.w.risk}
          auditId={approval.w.auditId ?? `pending · ${approval.w.id}`}
          onApprove={() => decide(approval.msg, approval.w, "approved")}
          onReject={() => decide(approval.msg, approval.w, "rejected")}
          approveLabel={approval.w.payload.kind === "undo" ? "Approve undo" : "Approve"}
        />
      )}
    </div>
  );
}

function WriteCard({ w, sandbox, onOpen }: { w: WriteProposal; sandbox: boolean; onOpen: () => void }) {
  const label: Record<WriteProposal["status"], string> = {
    proposed: "Waiting for your approval",
    drafted: "Saved as a draft for review",
    suggested: "Suggestion only: autonomy for this workflow is Suggest",
    auto: "Auto-approved within today's budget",
    approved: "Approved",
    rejected: "Rejected",
  };
  const tone = w.status === "approved" || w.status === "auto" ? "healthy" : w.status === "rejected" ? "neutral" : "watch";
  return (
    <div className="rounded-lg border border-border p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="type-caption font-semibold">{w.title}</span>
        <ToneBadge tone={tone}>{label[w.status]}</ToneBadge>
        <ToneBadge tone={w.risk.level === "low" ? "healthy" : w.risk.level === "medium" ? "watch" : "blocked"}>{w.risk.level} risk</ToneBadge>
      </div>
      <p className="mt-1 type-caption text-muted-foreground">
        {w.summary} Estimated cost {fmtUsd(w.costUsd)}.
        {w.auditId ? ` Audit ${w.auditId}.` : ""}
      </p>
      {(w.status === "proposed" || w.status === "drafted") && !sandbox && (
        <Button size="xs" className="mt-2" onClick={onOpen}>
          {w.status === "drafted" ? "Review draft" : "Review and approve"}
        </Button>
      )}
    </div>
  );
}
