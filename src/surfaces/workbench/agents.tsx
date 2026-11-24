// Agents page (Phase 7 §7.5): the roster with trigger, autonomy and success metric, status, run
// timeline as a ToolCallTrace, pending approvals, spend and a kill switch per agent.
import { useState } from "react";
import { Bot, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { SectionTitle } from "@/ui/primitives";
import { ToneBadge } from "@/ui/tone";
import { ToolCallTrace } from "@/ui/tool-call-trace";
import { fmtDate, fmtNum } from "@/core/format";
import { toast } from "sonner";
import { usePlatform } from "@/surfaces/platform/use-platform";
import { ApprovalsList, KillSwitch, toTrace } from "@/surfaces/workbench/mcp-console";
import { agentPrincipal, agentSpend, ROSTER, runAgent, setAgentPaused } from "@/platform/agents";
import { TIER_LABEL } from "@/platform/mcp";
import type { AgentId, McpActivity } from "@/platform/types";

export function AgentsPage() {
  const { t, apply, run } = usePlatform();
  const [sel, setSel] = useState<AgentId>("operator");
  const ag = t.platform.agents;
  const killed = t.platform.mcp.killSwitch;
  const def = ROSTER.find((a) => a.id === sel)!;
  const runs = ag.runs.filter((r) => r.agent === sel);
  const [runId, setRunId] = useState<string | null>(null);
  const cur = runs.find((r) => r.id === runId) ?? runs[0] ?? null;
  const calls = cur ? cur.activity.map((id) => t.platform.mcp.activity.find((a) => a.id === id)).filter((a): a is McpActivity => !!a) : [];
  const pendingOf = (id: AgentId) => t.platform.mcp.approvals.filter((a) => a.status === "pending" && a.principal === agentPrincipal(id)).length;
  const runNow = (id: AgentId) => {
    let text = "";
    let newId: string | null = null;
    const saved = apply((s) => {
      const r = runAgent(s, id, "Run now");
      text = r.text;
      newId = r.run?.id ?? null;
      return r.t;
    });
    if (newId) setRunId(newId);
    (newId && saved ? toast.success : toast.error)(text);
  };
  return (
    <div className="space-y-6">
      <KillSwitch />
      <section aria-labelledby="roster-h" className="space-y-3">
        <SectionTitle id="roster-h" aside="Scripted agents making real tool calls through the governed MCP layer">
          Agent roster
        </SectionTitle>
        <Table>
          <TableCaption className="sr-only">Agents with trigger, autonomy, success metric, status, spend and switch</TableCaption>
          <TableHeader>
            <TableRow>
              <TableHead scope="col">Agent</TableHead>
              <TableHead scope="col">Trigger and success metric</TableHead>
              <TableHead scope="col">Autonomy</TableHead>
              <TableHead scope="col">Status</TableHead>
              <TableHead scope="col" className="text-right">Granted today</TableHead>
              <TableHead scope="col" className="text-right">Waiting</TableHead>
              <TableHead scope="col">On</TableHead>
              <TableHead scope="col"><span className="sr-only">Actions</span></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {ROSTER.map((a) => {
              const paused = !!ag.paused[a.id];
              const last = ag.runs.find((r) => r.agent === a.id);
              return (
                <TableRow key={a.id} className={sel === a.id ? "bg-muted/60" : undefined}>
                  <TableHead scope="row">
                    <button type="button" className="text-left font-medium underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-ring" aria-pressed={sel === a.id} onClick={() => { setSel(a.id); setRunId(null); }}>
                      {a.name}
                    </button>
                    <span className="block type-caption font-normal text-muted-foreground">{last ? `Last run ${fmtDate(last.ts)}` : "No runs yet"}</span>
                  </TableHead>
                  <TableCell className="type-caption">
                    {a.trigger}
                    <span className="block text-muted-foreground">Metric: {a.metric}</span>
                  </TableCell>
                  <TableCell className="type-caption">
                    {a.autonomy}
                    <span className="block text-muted-foreground">{TIER_LABEL[a.tier]}</span>
                  </TableCell>
                  <TableCell>
                    <ToneBadge tone={killed ? "blocked" : paused ? "neutral" : "healthy"}>{killed ? "Halted" : paused ? "Off" : "Active"}</ToneBadge>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{fmtNum(agentSpend(t, a.id))}</TableCell>
                  <TableCell className="text-right tabular-nums">{pendingOf(a.id)}</TableCell>
                  <TableCell>
                    <Switch aria-label={`${a.name} on`} checked={!paused} onCheckedChange={(v) => run((s) => setAgentPaused(s, a.id, !v), `${a.name} ${v ? "on" : "off"}.`)} />
                  </TableCell>
                  <TableCell>
                    <Button size="xs" variant="outline" disabled={killed || paused} onClick={() => { setSel(a.id); runNow(a.id); }} aria-label={`Run ${a.name} now`}>
                      <Play aria-hidden="true" />
                      Run now
                    </Button>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </section>
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <section aria-labelledby="tl-h" className="space-y-3 rounded-xl border border-border bg-card p-4">
          <h3 id="tl-h" className="type-heading">
            <Bot aria-hidden="true" className="mr-1 inline size-4" />
            {def.name} · run timeline
          </h3>
          {runs.length === 0 ? (
            <p className="type-body text-muted-foreground">No runs yet. Use Run now, or move the Time machine: agents whose trigger fires run once a simulated day.</p>
          ) : (
            <>
              <div role="group" aria-label="Runs" className="flex flex-wrap gap-1.5">
                {runs.slice(0, 8).map((r) => (
                  <Button key={r.id} size="xs" variant={cur?.id === r.id ? "default" : "outline"} aria-pressed={cur?.id === r.id} onClick={() => setRunId(r.id)}>
                    {fmtDate(r.ts)} · {r.trigger}
                  </Button>
                ))}
              </div>
              {cur && <p className="type-body">{cur.text}</p>}
              <div>
                <Label className="type-caption">Tool calls</Label>
                <ToolCallTrace calls={toTrace(calls)} />
              </div>
            </>
          )}
        </section>
        <section aria-labelledby="ap2-h" className="space-y-3 rounded-xl border border-border bg-card p-4">
          <h3 id="ap2-h" className="type-heading">Pending approvals from agents</h3>
          <ApprovalsList filter={(p) => p.startsWith("agent:")} />
        </section>
      </div>
    </div>
  );
}
