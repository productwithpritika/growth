// MCP Console (Phase 7 §7.1–7.3, §7.7): servers and tools with tiers, a per-tool input editor
// (hide fields, defaults, min and max), a try-it panel with dry-run and idempotency keys, pending
// approvals, the activity log with "Explain this action", scoped tokens and Connect a client, the
// global kill switch, budgets, resources and prompts, and the external agent split screen.
import { Fragment, useMemo, useState } from "react";
import { Copy, KeyRound, OctagonX, Play, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { SectionTitle, Stat } from "@/ui/primitives";
import { ToneBadge } from "@/ui/tone";
import { ToolCallTrace } from "@/ui/tool-call-trace";
import type { Tone } from "@/core/types";
import type { ToolCall } from "@/mcp/types";
import { fmtNum, fmtUsd } from "@/core/format";
import { COMMANDS } from "@/agents/cb/engine";
import { usePlatform } from "@/surfaces/platform/use-platform";
import { useCockpit } from "@/lib/cockpit-store";
import { createPrincipal, decideApproval, explainActivity, resources, revokePrincipal, SERVERS, setBudgets, setConstraint, setKillSwitch, TIER_LABEL, TOOL_TIER_LABEL, TOOLS, toolByName } from "@/platform/mcp";
import type { CallOutcome, FieldConstraint, McpActivity, Principal } from "@/platform/types";
import { personaName } from "@/tenants/personas";

export const OUTCOME_TONE: Record<CallOutcome, Tone> = { ok: "healthy", draft: "info", pending: "watch", executed: "reward", denied: "blocked", "dry-run": "neutral", replayed: "neutral" };
export const OUTCOME_TEXT: Record<CallOutcome, string> = { ok: "Read", draft: "Drafted", pending: "Needs approval", executed: "Executed", denied: "Refused", "dry-run": "Dry run", replayed: "Replayed" };

export function toTrace(xs: McpActivity[]): ToolCall[] {
  return xs.map((a) => ({ id: a.id, tool: a.tool, args: a.args, status: a.outcome === "denied" ? "error" : a.outcome === "pending" ? "pending" : "ok", ms: a.ms, summary: a.outcome === "denied" ? a.reason : a.summary, result: a.result }));
}

export function KillSwitch() {
  const { t, run } = usePlatform();
  const on = t.platform.mcp.killSwitch;
  return (
    <div className={`flex items-center gap-3 rounded-xl border px-4 py-3 ${on ? "border-blocked bg-blocked-soft text-blocked-ink" : "border-border bg-card"}`}>
      <OctagonX aria-hidden="true" className="size-5 shrink-0" />
      <div className="min-w-0 flex-1">
        <Label htmlFor="kill" className="type-body font-semibold">Global kill switch</Label>
        <p className="type-caption">{on ? "On: every agent and external client is halted. People can still use the console." : "Off: agents run inside their tiers and budgets."}</p>
      </div>
      <Switch id="kill" checked={on} onCheckedChange={(v) => run((s) => setKillSwitch(s, v), v ? "Kill switch on: all agents halted." : "Kill switch off.")} />
    </div>
  );
}

const MCP_TABS = ["tools", "activity", "clients", "external"];

export function McpConsole() {
  const { t, setUi } = usePlatform();
  const sub = useCockpit((s) => s.wbSub);
  const [local, setLocal] = useState("tools");
  const tab = sub && MCP_TABS.includes(sub) ? sub : local;
  const m = t.platform.mcp;
  const today = t.clock.slice(0, 10);
  const pending = m.approvals.filter((a) => a.status === "pending");
  return (
    <div className="space-y-5">
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <KillSwitch />
        <div className="grid grid-cols-3 gap-4 rounded-xl border border-border bg-card p-4">
          <Stat label="Calls today" value={fmtNum(m.activity.filter((a) => a.ts.slice(0, 10) === today).length)} />
          <Stat label="Needs approval" value={fmtNum(pending.length)} />
          <Stat label="Tokens" value={fmtNum(m.principals.filter((p) => !p.revoked).length)} />
        </div>
      </div>
      <Tabs value={tab} onValueChange={(v) => { setLocal(v); if (sub) setUi({ wbSub: null }); }}>
        <TabsList aria-label="MCP Console sections" className="w-full flex-nowrap justify-start overflow-x-auto">
          <TabsTrigger value="tools">Servers and tools</TabsTrigger>
          <TabsTrigger value="activity">Approvals and activity{pending.length ? ` (${pending.length})` : ""}</TabsTrigger>
          <TabsTrigger value="clients">Clients, tokens and budgets</TabsTrigger>
          <TabsTrigger value="external">External agent demo</TabsTrigger>
        </TabsList>
        <TabsContent value="tools" className="pt-4">
          <ToolsPanel />
        </TabsContent>
        <TabsContent value="activity" className="pt-4">
          <ActivityPanel />
        </TabsContent>
        <TabsContent value="clients" className="pt-4">
          <ClientsPanel />
        </TabsContent>
        <TabsContent value="external" className="pt-4">
          <ExternalDemo />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ------------------------------------------------------------------ servers, tools, input editor, try it

function ToolsPanel() {
  const { t, run, call } = usePlatform();
  const m = t.platform.mcp;
  const [server, setServer] = useState("credits");
  const [toolName, setToolName] = useState("grant_reward");
  const tools = TOOLS.filter((x) => x.server === server);
  const tool = toolByName(toolName) && toolByName(toolName)!.server === server ? toolByName(toolName)! : tools[0];
  const cons = m.constraints[tool.name] ?? {};
  const [principal, setPrincipal] = useState("agent:dunning");
  const [args, setArgs] = useState<string | null>(null);
  const [dry, setDry] = useState(false);
  const [key, setKey] = useState("");
  const [last, setLast] = useState<McpActivity | null>(null);
  const sample = JSON.stringify(Object.fromEntries(tool.fields.filter((f) => !cons[f.name]?.hidden).map((f) => [f.name, f.name === "account" ? "dev" : f.name === "amount" ? 80 : f.name === "reason" ? "Thanks for the referral" : f.type === "number" ? 1 : f.type === "boolean" ? true : f.name === "skill" ? "company-research" : f.name === "cohort" ? "free-quiet" : f.name === "prompt" ? "Show a top-up banner to Growth users when forecast run-out is under 5 days, once per week" : ""])), null, 2);
  const text = args ?? sample;
  const recent = m.activity.filter((a) => a.tool === tool.name).slice(0, 5);
  const setRule = (field: string, patch: Partial<FieldConstraint>) => {
    const cur = { ...(cons[field] ?? {}), ...patch };
    const clean = Object.fromEntries(Object.entries(cur).filter(([, v]) => v !== undefined && v !== "" && !(typeof v === "number" && Number.isNaN(v)))) as FieldConstraint;
    run((s) => setConstraint(s, tool.name, field, Object.keys(clean).length ? clean : null), `${tool.name}.${field} updated.`, true);
  };
  const go = () => {
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(text) as Record<string, unknown>;
    } catch {
      toast.error("Arguments must be JSON.");
      return;
    }
    const a = call({ principal, tool: tool.name, args: parsed, dryRun: dry, idempotencyKey: key.trim() || null, prompt: "Console test call" });
    setLast(a);
  };
  return (
    <div className="grid gap-6 xl:grid-cols-[260px_minmax(0,1fr)]">
      <nav aria-label="MCP servers" className="space-y-1">
        {SERVERS.map((s) => (
          <button key={s.id} type="button" aria-pressed={server === s.id} onClick={() => { setServer(s.id); setToolName(TOOLS.find((x) => x.server === s.id)!.name); setArgs(null); setLast(null); }} className={`flex w-full items-center justify-between gap-2 rounded-md px-3 py-2 text-left type-body focus-visible:outline-2 focus-visible:outline-ring ${server === s.id ? "bg-muted font-semibold" : "hover:bg-muted"}`}>
            <span>
              {s.label}
              <span className="block type-caption font-normal text-muted-foreground">{TOOLS.filter((x) => x.server === s.id).length} tools · {s.existing ? "existing" : "new"}</span>
            </span>
          </button>
        ))}
      </nav>
      <div className="min-w-0 space-y-5">
        <div className="flex flex-wrap gap-2" role="group" aria-label="Tools">
          {tools.map((x) => (
            <Button key={x.name} size="sm" variant={x.name === tool.name ? "default" : "outline"} aria-pressed={x.name === tool.name} onClick={() => { setToolName(x.name); setArgs(null); setLast(null); }}>
              <span className="font-mono">{x.name}</span>
              <ToneBadge tone={x.tier === "read" ? "healthy" : x.tier === "draft" ? "info" : "watch"} className="ml-1">{TOOL_TIER_LABEL[x.tier]}</ToneBadge>
            </Button>
          ))}
        </div>
        <section aria-labelledby="tool-h" className="space-y-3 rounded-xl border border-border bg-card p-4">
          <h3 id="tool-h" className="type-heading">
            <span className="font-mono">{tool.name}</span> · {tool.description}
          </h3>
          <p className="type-caption text-muted-foreground">
            Tier: {TOOL_TIER_LABEL[tool.tier]}. {tool.tier === "approval" ? (tool.budget ? "Runs only after approval, or inside a standing budget for Auto-tier tokens." : "Always needs a person to approve it.") : tool.tier === "draft" ? "Creates drafts only." : "Reads only."}
          </p>
          <Table>
            <TableCaption>Tool input editor: what an agent may send to {tool.name}</TableCaption>
            <TableHeader>
              <TableRow>
                <TableHead scope="col">Field</TableHead>
                <TableHead scope="col">Hidden from agents</TableHead>
                <TableHead scope="col">Default</TableHead>
                <TableHead scope="col">Min</TableHead>
                <TableHead scope="col">Max</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {tool.fields.map((f) => {
                const c = cons[f.name] ?? {};
                const numeric = f.type === "number";
                return (
                  <TableRow key={f.name}>
                    <TableHead scope="row">
                      <span className="font-mono">{f.name}</span>
                      {f.required ? <span className="ml-1 type-caption text-muted-foreground">required</span> : null}
                      <span className="block type-caption font-normal text-muted-foreground">{f.description}</span>
                    </TableHead>
                    <TableCell>
                      <Switch aria-label={`Hide ${f.name}`} checked={!!c.hidden} disabled={f.required} onCheckedChange={(v) => setRule(f.name, { hidden: v || undefined })} />
                    </TableCell>
                    <TableCell>
                      <Input aria-label={`Default for ${f.name}`} className="h-8 w-28" defaultValue={c.default === undefined ? "" : String(c.default)} key={`d-${tool.name}-${f.name}-${String(c.default)}`} onBlur={(e) => setRule(f.name, { default: e.target.value === "" ? undefined : numeric ? Number(e.target.value) : e.target.value })} />
                    </TableCell>
                    <TableCell>{numeric ? <Input aria-label={`Minimum for ${f.name}`} type="number" className="h-8 w-20" defaultValue={c.min ?? ""} key={`n-${tool.name}-${f.name}-${c.min}`} onBlur={(e) => setRule(f.name, { min: e.target.value === "" ? undefined : Number(e.target.value) })} /> : "—"}</TableCell>
                    <TableCell>{numeric ? <Input aria-label={`Maximum for ${f.name}`} type="number" className="h-8 w-20" defaultValue={c.max ?? ""} key={`x-${tool.name}-${f.name}-${c.max}`} onBlur={(e) => setRule(f.name, { max: e.target.value === "" ? undefined : Number(e.target.value) })} /> : "—"}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </section>
        <section aria-labelledby="try-h" className="space-y-3 rounded-xl border border-border bg-card p-4">
          <h3 id="try-h" className="type-heading">Try it as a token</h3>
          <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="try-p">Call as</Label>
                <NativeSelect id="try-p" value={principal} onChange={(e) => setPrincipal(e.target.value)}>
                  {m.principals.filter((p) => !p.revoked).map((p) => (
                    <NativeSelectOption key={p.id} value={p.id}>
                      {p.label} · {TIER_LABEL[p.tier]}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              </div>
              <div className="flex items-center gap-2">
                <Checkbox id="try-dry" checked={dry} onCheckedChange={(v) => setDry(!!v)} />
                <Label htmlFor="try-dry" className="font-normal">Dry run (show what would happen, write nothing)</Label>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="try-key">Idempotency key (optional)</Label>
                <Input id="try-key" value={key} onChange={(e) => setKey(e.target.value)} placeholder="e.g. referral-dev-0423" />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="try-args">Arguments</Label>
              <Textarea id="try-args" rows={7} className="font-mono text-xs" value={text} onChange={(e) => setArgs(e.target.value)} />
            </div>
          </div>
          <Button onClick={go}>
            <Play aria-hidden="true" />
            Call {tool.name}
          </Button>
          {last && <ActivityCard a={last} />}
          {recent.length > 0 && (
            <div className="space-y-1">
              <div className="type-caption font-medium">Recent calls</div>
              <ToolCallTrace calls={toTrace(recent)} />
            </div>
          )}
        </section>
        <section aria-labelledby="res-h" className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2 rounded-xl border border-border bg-card p-4">
            <h3 id="res-h" className="type-heading">Resources</h3>
            <ul className="space-y-1 font-mono type-caption">
              {resources(t).map((r) => (
                <li key={r.uri} title={r.label}>
                  {r.uri}
                </li>
              ))}
            </ul>
          </div>
          <div className="space-y-2 rounded-xl border border-border bg-card p-4">
            <h3 className="type-heading">Prompts</h3>
            <p className="type-caption text-muted-foreground">Every Ask CB slash command is also an MCP prompt.</p>
            <ul className="flex flex-wrap gap-1.5">
              {COMMANDS.map((c) => (
                <li key={c.name} className="rounded bg-muted px-1.5 py-0.5 font-mono type-caption" title={c.help}>
                  /{c.name}
                </li>
              ))}
            </ul>
          </div>
        </section>
      </div>
    </div>
  );
}

export function ActivityCard({ a }: { a: McpActivity }) {
  const { t } = usePlatform();
  return (
    <div role="status" className="space-y-1 rounded-lg border border-border p-3">
      <div className="flex flex-wrap items-center gap-2">
        <ToneBadge tone={OUTCOME_TONE[a.outcome]}>{OUTCOME_TEXT[a.outcome]}</ToneBadge>
        <span className="font-mono type-caption">{a.tool}</span>
        <span className="type-caption text-muted-foreground">{a.principalLabel}</span>
      </div>
      <p className="type-body">{a.outcome === "denied" ? a.reason : a.summary}</p>
      <p className="type-caption text-muted-foreground">{explainActivity(t, a)}</p>
    </div>
  );
}

// ------------------------------------------------------------------ approvals and activity

export function ApprovalsList({ filter }: { filter?: (principal: string) => boolean }) {
  const { t, apply, who } = usePlatform();
  const list = t.platform.mcp.approvals.filter((a) => a.status === "pending" && (!filter || filter(a.principal)));
  const decide = (id: string, ok: boolean) => {
    let res: McpActivity | null = null;
    apply((s) => {
      const r = decideApproval(s, id, ok, who);
      if (!r) return s;
      res = r.activity;
      return r.t;
    });
    const a = res as McpActivity | null;
    if (!a) return;
    (a.outcome === "executed" ? toast.success : ok ? toast.error : toast.message)(a.outcome === "executed" ? `Approved and executed: ${a.summary}` : a.reason);
  };
  if (!list.length) return <p className="type-body text-muted-foreground">Nothing is waiting for approval.</p>;
  return (
    <ul className="space-y-2">
      {list.map((a) => (
        <li key={a.id} className="flex flex-wrap items-start justify-between gap-3 rounded-lg border border-watch bg-watch-soft/40 p-3">
          <div className="min-w-0 flex-1 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono type-caption font-semibold">{a.tool}</span>
              <span className="type-caption text-muted-foreground">from {a.principalLabel}</span>
            </div>
            <pre className="overflow-x-auto rounded bg-muted p-2 font-mono text-xs">{JSON.stringify(Object.fromEntries(Object.entries(a.args).map(([k, v]) => [k, v])), null, 0)}</pre>
            {a.prompt && <p className="type-caption text-muted-foreground">Asked: “{a.prompt}”</p>}
          </div>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => decide(a.id, false)}>
              Reject
            </Button>
            <Button size="sm" onClick={() => decide(a.id, true)}>
              <ShieldCheck aria-hidden="true" />
              Approve
            </Button>
          </div>
        </li>
      ))}
    </ul>
  );
}

function ActivityPanel() {
  const { t } = usePlatform();
  const [open, setOpen] = useState<string | null>(null);
  const [who, setWho] = useState("all");
  const list = t.platform.mcp.activity.filter((a) => who === "all" || a.principal === who).slice(0, 60);
  return (
    <div className="space-y-6">
      <section aria-labelledby="ap-h" className="space-y-3">
        <SectionTitle id="ap-h">Pending approvals</SectionTitle>
        <ApprovalsList />
      </section>
      <section aria-labelledby="log-h" className="space-y-3">
        <SectionTitle
          id="log-h"
          aside={
            <NativeSelect aria-label="Filter by caller" size="sm" value={who} onChange={(e) => setWho(e.target.value)}>
              <NativeSelectOption value="all">Every caller</NativeSelectOption>
              {t.platform.mcp.principals.map((p) => (
                <NativeSelectOption key={p.id} value={p.id}>
                  {p.label}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          }
        >
          Activity log
        </SectionTitle>
        <p className="type-caption text-muted-foreground">Arguments and prompts are masked before they are logged. Every entry records the caller, tool, outcome, approver and idempotency key.</p>
        {list.length === 0 ? (
          <p className="type-body text-muted-foreground">No calls yet. Use Try it, run an agent, or the external agent demo.</p>
        ) : (
          <Table>
            <TableCaption className="sr-only">Recent MCP tool calls</TableCaption>
            <TableHeader>
              <TableRow>
                <TableHead scope="col">Caller</TableHead>
                <TableHead scope="col">Tool</TableHead>
                <TableHead scope="col">Outcome</TableHead>
                <TableHead scope="col">Approver</TableHead>
                <TableHead scope="col">Arguments</TableHead>
                <TableHead scope="col"><span className="sr-only">Explain</span></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {list.map((a) => (
                <Fragment key={a.id}>
                  <TableRow>
                    <TableCell className="type-caption">{a.principalLabel}</TableCell>
                    <TableHead scope="row" className="font-mono text-xs">
                      {a.tool}
                      {a.dryRun ? " (dry run)" : ""}
                    </TableHead>
                    <TableCell>
                      <ToneBadge tone={OUTCOME_TONE[a.outcome]}>{OUTCOME_TEXT[a.outcome]}</ToneBadge>
                    </TableCell>
                    <TableCell className="type-caption">{a.approver ?? "—"}</TableCell>
                    <TableCell className="max-w-64 truncate font-mono text-xs">{JSON.stringify(a.args)}</TableCell>
                    <TableCell>
                      <Button size="xs" variant="ghost" aria-expanded={open === a.id} onClick={() => setOpen(open === a.id ? null : a.id)}>
                        Explain this action
                      </Button>
                    </TableCell>
                  </TableRow>
                  {open === a.id && (
                    <TableRow>
                      <TableCell colSpan={6} className="whitespace-normal bg-muted/50 type-body">
                        {explainActivity(t, a)}
                        {a.idempotencyKey ? ` Idempotency key: ${a.idempotencyKey}.` : ""}
                      </TableCell>
                    </TableRow>
                  )}
                </Fragment>
              ))}
            </TableBody>
          </Table>
        )}
      </section>
    </div>
  );
}

// ------------------------------------------------------------------ clients, tokens and budgets

function ClientsPanel() {
  const { t, apply, run } = usePlatform();
  const m = t.platform.mcp;
  const [label, setLabel] = useState("Sales copilot");
  const [role, setRole] = useState<Principal["role"]>("analyst");
  const [servers, setServers] = useState<string[]>(["credits", "growth"]);
  const [account, setAccount] = useState<"" | "maya" | "dev">("");
  const [rate, setRate] = useState(30);
  const [shown, setShown] = useState<{ token: string; label: string } | null>(null);
  const [b, setB] = useState(m.budgets);
  const connect = () => {
    let tok: { token: string; label: string } | null = null;
    const saved = apply((s) => {
      const r = createPrincipal(s, { label: label.trim() || "External client", kind: "external", role, servers, account: account || null, rateLimitPerMin: rate });
      tok = { token: r.token, label: r.principal.label };
      return r.t;
    });
    if (tok) setShown(tok);
    (saved ? toast.success : toast.error)(saved ? "Client connected. Copy the token now: it is shown once." : "Not saved in this browser.");
  };
  const ROLES: { id: Principal["role"]; label: string }[] = [
    { id: "viewer", label: "Viewer · Read" },
    { id: "analyst", label: "Analyst · Draft" },
    { id: "operator", label: "Operator · Execute with approval" },
    { id: "automation", label: "Automation · Auto within budget" },
  ];
  return (
    <div className="space-y-6">
      <div className="grid gap-6 xl:grid-cols-2">
        <section aria-labelledby="conn-h" className="space-y-3 rounded-xl border border-border bg-card p-4">
          <h3 id="conn-h" className="type-heading">Connect a client</h3>
          <p className="type-caption text-muted-foreground">Simulated: an external AI client gets a scoped token for this tenant only.</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="cl-name">Client name</Label>
              <Input id="cl-name" value={label} onChange={(e) => setLabel(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cl-role">Role and tier</Label>
              <NativeSelect id="cl-role" value={role} onChange={(e) => setRole(e.target.value as Principal["role"])}>
                {ROLES.map((r) => (
                  <NativeSelectOption key={r.id} value={r.id}>
                    {r.label}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cl-acc">Account scope</Label>
              <NativeSelect id="cl-acc" value={account} onChange={(e) => setAccount(e.target.value as "" | "maya" | "dev")}>
                <NativeSelectOption value="">Merchant-wide</NativeSelectOption>
                <NativeSelectOption value="maya">{personaName(t.pack, "maya")}'s workspace only</NativeSelectOption>
                <NativeSelectOption value="dev">{personaName(t.pack, "dev")}'s workspace only</NativeSelectOption>
              </NativeSelect>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cl-rate">Rate limit (calls a minute)</Label>
              <Input id="cl-rate" type="number" min={1} max={600} value={rate} onChange={(e) => setRate(Math.max(1, Number(e.target.value) || 1))} />
            </div>
          </div>
          <fieldset className="space-y-1.5">
            <legend className="type-caption font-medium">Servers</legend>
            <div className="flex flex-wrap gap-3">
              {SERVERS.map((s) => (
                <label key={s.id} className="flex items-center gap-2 type-body">
                  <Checkbox checked={servers.includes(s.id)} onCheckedChange={(v) => setServers(v ? [...servers, s.id] : servers.filter((x) => x !== s.id))} />
                  {s.label}
                </label>
              ))}
            </div>
          </fieldset>
          <Button onClick={connect} disabled={!servers.length}>
            <KeyRound aria-hidden="true" />
            Create scoped token
          </Button>
          {shown && (
            <div role="status" className="space-y-1 rounded-lg border border-info bg-info-soft p-3 text-info-ink">
              <p className="type-caption font-semibold">Token for {shown.label}: shown once</p>
              <div className="flex items-center gap-2">
                <code className="min-w-0 flex-1 truncate font-mono text-xs">{shown.token}</code>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  aria-label="Copy token"
                  onClick={() => {
                    void navigator.clipboard?.writeText(shown.token).then(() => toast.success("Copied."), () => toast.error("Copy failed."));
                  }}
                >
                  <Copy aria-hidden="true" />
                </Button>
                <Button size="sm" variant="outline" onClick={() => setShown(null)}>
                  Done
                </Button>
              </div>
            </div>
          )}
        </section>
        <section aria-labelledby="bud-h" className="space-y-3 rounded-xl border border-border bg-card p-4">
          <h3 id="bud-h" className="type-heading">Standing budgets for Auto within budget</h3>
          <form
            className="grid gap-3 sm:grid-cols-3"
            onSubmit={(e) => {
              e.preventDefault();
              run((s) => setBudgets(s, b), "Budgets saved.");
            }}
          >
            <div className="space-y-1.5">
              <Label htmlFor="b-cr">Credits granted per day</Label>
              <Input id="b-cr" type="number" min={0} value={b.creditsPerDay} onChange={(e) => setB({ ...b, creditsPerDay: Math.max(0, Number(e.target.value) || 0) })} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="b-sp">Spend per day (USD)</Label>
              <Input id="b-sp" type="number" min={0} value={b.spendPerDay} onChange={(e) => setB({ ...b, spendPerDay: Math.max(0, Number(e.target.value) || 0) })} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="b-ex">Concurrent experiments</Label>
              <Input id="b-ex" type="number" min={0} value={b.concurrentExperiments} onChange={(e) => setB({ ...b, concurrentExperiments: Math.max(0, Number(e.target.value) || 0) })} />
            </div>
            <p className="type-caption text-muted-foreground sm:col-span-3">
              Approved by {m.budgets.approvedBy}. Used today: {fmtNum(m.spent.day === t.clock.slice(0, 10) ? m.spent.credits : 0)} credits, {fmtUsd(m.spent.day === t.clock.slice(0, 10) ? m.spent.usd : 0, 0)}. Anything over a budget goes to approval.
            </p>
            <Button type="submit" size="sm" variant="outline" className="sm:col-span-3 sm:w-fit">
              Save budgets
            </Button>
          </form>
        </section>
      </div>
      <section aria-labelledby="tok-h" className="space-y-3">
        <SectionTitle id="tok-h" aside="Least privilege: each token gets one tier, its servers and, for customers, one account">
          Scoped tokens
        </SectionTitle>
        <Table>
          <TableCaption className="sr-only">Tokens with role, tier, servers, account scope and rate limit</TableCaption>
          <TableHeader>
            <TableRow>
              <TableHead scope="col">Token</TableHead>
              <TableHead scope="col">Tier</TableHead>
              <TableHead scope="col">Servers</TableHead>
              <TableHead scope="col">Account</TableHead>
              <TableHead scope="col" className="text-right">Rate</TableHead>
              <TableHead scope="col">Fingerprint</TableHead>
              <TableHead scope="col"><span className="sr-only">Revoke</span></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {m.principals.map((p) => (
              <TableRow key={p.id} className={p.revoked ? "opacity-60" : undefined}>
                <TableHead scope="row">
                  {p.label}
                  <span className="block type-caption font-normal text-muted-foreground">{p.kind} · tenant {p.tenant}</span>
                </TableHead>
                <TableCell>{TIER_LABEL[p.tier]}</TableCell>
                <TableCell className="type-caption">{p.servers.map((s) => SERVERS.find((x) => x.id === s)?.label ?? s).join(", ")}</TableCell>
                <TableCell>{p.account ? personaName(t.pack, p.account) : "Merchant-wide"}</TableCell>
                <TableCell className="text-right tabular-nums">{p.rateLimitPerMin}/min</TableCell>
                <TableCell className="font-mono text-xs">{p.fingerprint}</TableCell>
                <TableCell>
                  {p.kind === "external" && !p.revoked ? (
                    <Button size="xs" variant="ghost" onClick={() => run((s) => revokePrincipal(s, p.id), `${p.label} revoked.`)}>
                      Revoke
                    </Button>
                  ) : p.revoked ? (
                    "Revoked"
                  ) : null}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </section>
    </div>
  );
}

// ------------------------------------------------------------------ external agent demo (§7.7)

interface Turn {
  who: "user" | "client";
  text: string;
}

export function ExternalDemo() {
  const { t, call } = usePlatform();
  const [turns, setTurns] = useState<Turn[]>([]);
  const [ids, setIds] = useState<string[]>([]);
  const p = t.platform.mcp.principals.find((x) => x.id === "ext:generic");
  const calls = useMemo(() => ids.map((id) => t.platform.mcp.activity.find((a) => a.id === id)).filter((a): a is McpActivity => !!a), [ids, t.platform.mcp.activity]);
  const dev = personaName(t.pack, "dev");
  const askRun = () => {
    const q = "Can I run this table with the credits I have?";
    const a1 = call({ principal: "ext:generic", tool: "get_balance", args: { account: "dev" }, prompt: q });
    const a2 = call({ principal: "ext:generic", tool: "estimate_run_cost", args: { account: "dev" }, prompt: q });
    const est = a2?.result as { fits?: boolean; table?: string; rows?: number; need?: Record<string, number>; have?: Record<string, number> } | null;
    let answer = a2?.outcome === "denied" || a1?.outcome === "denied" ? `I couldn't check: ${(a2?.outcome === "denied" ? a2 : a1)?.reason}` : "";
    if (!answer && est) {
      const parts = t.pack.meters.map((m) => `${fmtNum(Math.round(est.need?.[m.id] ?? 0))} of ${fmtNum(Math.round(est.have?.[m.id] ?? 0))} ${m.label}`);
      answer = est.fits ? `Yes. "${est.table}" (${fmtNum(est.rows ?? 0)} rows) needs about ${parts.join(" and ")} you have, so it fits.` : `Not quite. "${est.table}" (${fmtNum(est.rows ?? 0)} rows) needs ${parts.join(" and ")} available. Top up first or run fewer rows.`;
    }
    setTurns((x) => [...x, { who: "user", text: q }, { who: "client", text: answer }]);
    setIds((x) => [...x, ...[a1?.id, a2?.id].filter((v): v is string => !!v)]);
  };
  const askAuto = () => {
    const q = "Turn on auto top-up so I don't run out.";
    const a = call({ principal: "ext:generic", tool: "set_auto_topup", args: { account: "dev", enabled: true, threshold: t.hub.dev.autoTopUp.threshold, units: t.hub.dev.autoTopUp.units }, prompt: q });
    const text = a?.outcome === "pending" ? `I can't switch that on myself: it changes billing, so I sent it for approval. ${dev} or an admin approves it in the console.` : a?.outcome === "denied" ? `That was refused: ${a.reason}` : `Done: ${a?.summary}`;
    setTurns((x) => [...x, { who: "user", text: q }, { who: "client", text }]);
    if (a) setIds((x) => [...x, a.id]);
  };
  const askOther = () => {
    const q = "And what's Maya's balance?";
    const a = call({ principal: "ext:generic", tool: "get_balance", args: { account: "maya" }, prompt: q });
    setTurns((x) => [...x, { who: "user", text: q }, { who: "client", text: a?.outcome === "denied" ? `I can't see that. ${a.reason}` : a?.summary ?? "" }]);
    if (a) setIds((x) => [...x, a.id]);
  };
  return (
    <div className="space-y-4">
      <p className="type-body text-muted-foreground">
        A generic AI client connected to {dev}'s workspace with a scoped token ({p ? `${TIER_LABEL[p.tier]}, Credits server, ${p.rateLimitPerMin} calls a minute` : "revoked"}). Left: what the user sees. Right: every tool call it made.
      </p>
      <div className="grid gap-4 lg:grid-cols-2">
        <section aria-labelledby="ext-chat" className="flex min-h-80 flex-col rounded-xl border border-border bg-card">
          <h3 id="ext-chat" className="border-b border-border px-4 py-2 type-body font-semibold">
            AI client · {dev}
          </h3>
          <ol aria-live="polite" className="flex-1 space-y-2 overflow-y-auto p-4">
            {turns.length === 0 && <li className="type-body text-muted-foreground">Pick a question below.</li>}
            {turns.map((x, i) => (
              <li key={i} className={`max-w-[85%] rounded-lg px-3 py-2 type-body ${x.who === "user" ? "ml-auto bg-primary text-primary-foreground" : "bg-muted"}`}>
                {x.text}
              </li>
            ))}
          </ol>
          <div className="flex flex-wrap gap-2 border-t border-border p-3">
            <Button size="sm" onClick={askRun}>
              Can I run this table with the credits I have?
            </Button>
            <Button size="sm" variant="outline" onClick={askAuto}>
              Turn on auto top-up
            </Button>
            <Button size="sm" variant="outline" onClick={askOther}>
              What's Maya's balance?
            </Button>
          </div>
        </section>
        <section aria-labelledby="ext-trace" className="space-y-2 rounded-xl border border-border bg-card p-4">
          <h3 id="ext-trace" className="type-body font-semibold">ToolCallTrace</h3>
          <ToolCallTrace calls={toTrace(calls)} empty="No calls yet." />
          {calls.some((c) => c.outcome === "pending") && (
            <div className="space-y-2 pt-2">
              <div className="type-caption font-medium">Waiting for approval</div>
              <ApprovalsList filter={(pr) => pr === "ext:generic"} />
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
