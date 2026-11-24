// The agent roster (Phase 7 §7.5): scripted agents that make real tool calls through the governed
// MCP gateway, so tiers, constraints, budgets, approvals and kill switches all apply to them.
// Agents act only on their script and on structured fields; text they read (help chats, dataset
// rows, tool output) is data and never becomes an instruction.
import type { TenantState } from "@/core/types";
import { balanceOf } from "@/core/ledger";
import { primaryMeter } from "@/core/pack";
import { dayOf, gid } from "@/growth/state";
import { guardReadings, scorecard } from "@/growth/lab";
import { dailyHypotheses } from "@/growth/ideas";
import { latestRun } from "@/platform/evals";
import { invoke, type CallRequest } from "@/platform/mcp";
import type { AgentId, AgentRun, Tier } from "@/platform/types";

export interface AgentDef {
  id: AgentId;
  name: string;
  trigger: string;
  autonomy: string;
  tier: Tier;
  metric: string;
  servers: string[];
  /** Whether today's state fires the trigger (daily step). */
  fires: (t: TenantState) => boolean;
  /** The calls to make, given the state. */
  script: (t: TenantState) => Omit<CallRequest, "principal">[];
  summary: (t: TenantState, outcomes: string[]) => string;
}

const acct = "dev" as const;

export const ROSTER: AgentDef[] = [
  {
    id: "onboarding",
    name: "Onboarding Agent",
    trigger: "Source connected",
    autonomy: "Execute within consent",
    tier: "auto",
    metric: "Time to first experiment",
    servers: ["onboarding", "growth"],
    fires: (t) => t.growth.onboarding.stage === "reveal",
    script: () => [
      { tool: "get_onboarding_status", args: {}, prompt: "Where is onboarding?" },
      { tool: "list_cohorts", args: {}, prompt: "Which cohorts exist?" },
      { tool: "generate_hypotheses", args: {}, prompt: "What should the first experiment be?" },
    ],
    summary: (_t, o) => `Checked onboarding and proposed a first experiment (${o.join(", ")}).`,
  },
  {
    id: "coach",
    name: "Usage Coach",
    trigger: "Cost estimate or low balance",
    autonomy: "Suggest",
    tier: "read",
    metric: "Runs completed without exhaustion",
    servers: ["credits"],
    fires: (t) => balanceOf(t.ledger, acct, primaryMeter(t.pack).id) < 0.25 * Math.max(1, t.pack.autoTopUp.threshold * 4),
    script: () => [
      { tool: "get_balance", args: { account: acct }, prompt: "How much is left?" },
      { tool: "get_burn_forecast", args: { account: acct }, prompt: "When does it run out?" },
      { tool: "estimate_run_cost", args: { account: acct, rows: 500 }, prompt: "Will the next run fit?" },
    ],
    summary: () => "Suggested splitting the next run so it finishes before the balance runs out. Suggest only: nothing changed.",
  },
  {
    id: "concierge",
    name: "Top-up Concierge",
    trigger: "Balance under threshold",
    autonomy: "Draft",
    tier: "draft",
    metric: "Top-up conversion, auto top-up adoption",
    servers: ["credits"],
    fires: (t) => balanceOf(t.ledger, acct, primaryMeter(t.pack).id) < t.hub[acct].autoTopUp.threshold * 1.5,
    script: (t) => [
      { tool: "get_balance", args: { account: acct }, prompt: "Is the balance under the threshold?" },
      { tool: "create_topup_quote", args: { account: acct, meter: primaryMeter(t.pack).id, units: Math.max(100, t.hub[acct].autoTopUp.units) }, prompt: "Quote the usual top-up" },
    ],
    summary: () => "Drafted a top-up quote for the customer. Nothing is charged until they buy.",
  },
  {
    id: "dunning",
    name: "Dunning Rescue",
    trigger: "Failed payment",
    autonomy: "Approval",
    tier: "approval",
    metric: "Recovery rate",
    servers: ["data", "credits"],
    fires: (t) => Object.values(t.hub).some((h) => h.dunning.status === "grace"),
    script: (t) => {
      const who = (Object.entries(t.hub).find(([, h]) => h.dunning.status === "grace")?.[0] ?? "maya") as "maya" | "dev";
      return [
        { tool: "lookup_subscription", args: { account: who }, prompt: "Why did the renewal fail?" },
        { tool: "grant_reward", args: { account: who, amount: 25, reason: "Grace credits while the card is updated" }, prompt: "Keep their runs going during the grace window", idempotencyKey: `dunning-${who}-${dayOf(t.clock)}` },
      ];
    },
    summary: (_t, o) => (o.includes("pending") ? "Asked for approval to grant 25 grace credits while the card is updated." : "Checked payment health."),
  },
  {
    id: "hypothesis",
    name: "Hypothesis Agent",
    trigger: "Daily",
    autonomy: "Draft",
    tier: "draft",
    metric: "Experiments launched per week",
    servers: ["growth"],
    fires: () => true,
    script: (t) => {
      const top = dailyHypotheses(t, dayOf(t.clock))[0];
      const waiting = t.growth.lab.filter((e) => e.status === "draft" && e.owner.endsWith(" agent")).length;
      return [
        { tool: "generate_hypotheses", args: {}, prompt: "Today's hypotheses" },
        ...(top && waiting < 2 ? [{ tool: "create_experiment_draft", args: { hypothesis: top.id }, prompt: "Draft the top hypothesis", idempotencyKey: `hyp-${top.id}-${dayOf(t.clock)}` }] : []),
      ];
    },
    summary: (_t, o) => (o.includes("draft") ? "Ranked today's hypotheses and drafted the top one. A person launches it." : "Ranked today's hypotheses. Two agent drafts are already waiting, so no new draft."),
  },
  {
    id: "operator",
    name: "Experiment Operator",
    trigger: "Experiment running",
    autonomy: "Auto within budget",
    tier: "auto",
    metric: "Experiments read out on time",
    servers: ["growth"],
    fires: (t) => t.growth.lab.some((e) => !e.sandbox && (e.status === "running" || e.status === "readout")),
    script: (t) => {
      const live = t.growth.lab.filter((e) => !e.sandbox && (e.status === "running" || e.status === "readout")).slice(0, 4);
      const out: Omit<CallRequest, "principal">[] = [];
      for (const e of live) {
        out.push({ tool: "get_scorecard", args: { experiment: e.id }, prompt: `How is ${e.name} doing?` });
        if (e.status === "running" && guardReadings(e).some((g) => g.breached)) out.push({ tool: "pause_experiment", args: { experiment: e.id, reason: "A guardrail breached" }, prompt: "Pause on a guardrail breach", idempotencyKey: `pause-${e.id}` });
        if (e.status === "readout" && scorecard(e).verdict === "Ship") out.push({ tool: "ship_variant", args: { experiment: e.id }, prompt: `Ship ${e.name}`, idempotencyKey: `ship-${e.id}` });
      }
      return out;
    },
    summary: (_t, o) => `Read ${o.filter((x) => x === "ok").length} scorecards${o.includes("executed") ? ", paused a breached test inside its budget" : ""}${o.includes("pending") ? ", and asked a person to approve a ship" : ""}.`,
  },
  {
    id: "eval",
    name: "Eval Agent",
    trigger: "Skill or model change",
    autonomy: "Auto",
    tier: "auto",
    metric: "Cost per quality point",
    servers: ["evals"],
    fires: (t) => t.platform.evals.skills.some((s) => {
      const last = latestRun(t.platform.evals, s.id);
      return !!last && t.platform.evals.providerChanges.some((c) => c.at > last.at && last.models.includes(c.model));
    }),
    script: (t) => {
      const ev = t.platform.evals;
      const stale = ev.skills.filter((s) => {
        const last = latestRun(ev, s.id);
        return s.status === "live" && last && ev.providerChanges.some((c) => c.at > last.at && last.models.includes(c.model));
      });
      const target = stale.length ? stale : ev.skills.filter((s) => s.status === "live").slice(0, 1);
      return target.flatMap((s) => [
        ...(stale.length ? [{ tool: "run_eval", args: { skill: s.id, repeats: 3 }, prompt: `Re-evaluate ${s.manifest.name} after a model change` }] : []),
        { tool: "recommend_model", args: { skill: s.id }, prompt: `Cheapest model within the margin for ${s.manifest.name}` },
      ]);
    },
    summary: (_t, o) => (o.includes("draft") ? "Re-ran evals after a model change and refreshed the recommendation." : "Checked the model recommendation; nothing changed upstream."),
  },
  {
    id: "winback",
    name: "Win-back Agent",
    trigger: "Quiet 14 days",
    autonomy: "Approval",
    tier: "approval",
    metric: "Reactivation rate",
    servers: ["growth", "offers"],
    fires: () => false,
    script: (t) => [
      { tool: "get_cohort_behaviour", args: { cohort: "free-quiet" }, prompt: "Why are quiet users quiet?" },
      { tool: "create_offer_draft", args: { cohort: "free-quiet", pctOff: 20, months: 1 }, prompt: "Draft a win-back offer", idempotencyKey: `winback-offer-${dayOf(t.clock)}` },
      { tool: "grant_from_breakage", args: { label: "Win-back starter credits", accounts: 40, creditsEach: 20 }, prompt: "Fund starter credits from breakage", idempotencyKey: `winback-fund-${dayOf(t.clock)}` },
    ],
    summary: (_t, o) => (o.includes("pending") ? "Drafted a win-back offer and asked for approval to fund starter credits from breakage." : "Drafted a win-back offer."),
  },
  {
    id: "sentinel",
    name: "Policy Sentinel",
    trigger: "Region rule change",
    autonomy: "Suggest",
    tier: "read",
    metric: "Compliance issues caught",
    servers: ["kb", "portal"],
    fires: () => false,
    script: () => [
      { tool: "search_kb", args: { query: "regional tax and consent rules" }, prompt: "Any region rule changes?" },
      { tool: "get_portal_config", args: {}, prompt: "Which moments could a rule change affect?" },
    ],
    summary: (t) => `Checked ${t.pack.regions.length} regions against live moments. Nothing to change. Suggest only.`,
  },
];

export const agentPrincipal = (id: AgentId) => `agent:${id}`;
export const agentById = (id: string) => ROSTER.find((a) => a.id === id) ?? null;

/** Run one agent's script through the gateway. A halted or paused agent makes no calls. */
export function runAgent(t0: TenantState, id: AgentId, trigger: string, wall?: number): { t: TenantState; run: AgentRun | null; text: string } {
  const def = agentById(id);
  if (!def) return { t: t0, run: null, text: "Unknown agent." };
  if (t0.platform.mcp.killSwitch) return { t: t0, run: null, text: "The global kill switch is on. No agent runs." };
  if (t0.platform.agents.paused[id]) return { t: t0, run: null, text: `${def.name} is switched off.` };
  let t = t0;
  const ids: string[] = [];
  const outcomes: string[] = [];
  const calls = def.script(t0);
  for (let i = 0; i < calls.length; i++) {
    const r = invoke(t, { ...calls[i], principal: agentPrincipal(id), wall: wall == null ? undefined : wall + i * 1000 });
    t = r.t;
    ids.push(r.activity.id);
    outcomes.push(r.activity.outcome);
  }
  const run: AgentRun = { id: gid("arun", t.clock), agent: id, ts: t.clock, trigger, activity: ids, text: def.summary(t, outcomes) };
  t = { ...t, platform: { ...t.platform, agents: { ...t.platform.agents, runs: [run, ...t.platform.agents.runs].slice(0, 80) } } };
  return { t, run, text: run.text };
}

export function setAgentPaused(t: TenantState, id: AgentId, paused: boolean): TenantState {
  return { ...t, platform: { ...t.platform, agents: { ...t.platform.agents, paused: { ...t.platform.agents.paused, [id]: paused } } } };
}

/** Daily: every agent whose trigger fires runs once. */
export function stepAgents(t0: TenantState): TenantState {
  let t = t0;
  if (t.platform.mcp.killSwitch) return t;
  for (const a of ROSTER) {
    if (t.platform.agents.paused[a.id]) continue;
    let fires = false;
    try {
      fires = a.fires(t);
    } catch {
      fires = false;
    }
    if (!fires) continue;
    t = runAgent(t, a.id, a.trigger, new Date(t.clock).getTime()).t;
  }
  return t;
}

/** Credits granted today by an agent (executed grant calls). */
export function agentSpend(t: TenantState, id: AgentId): number {
  const day = dayOf(t.clock);
  return t.platform.mcp.activity
    .filter((a) => a.principal === agentPrincipal(id) && a.outcome === "executed" && a.ts.slice(0, 10) === day)
    .reduce((s, a) => s + (a.tool === "grant_reward" ? Number(a.args.amount ?? 0) : a.tool === "grant_from_breakage" ? Number(a.args.accounts ?? 0) * Number(a.args.creditsEach ?? 0) : 0), 0);
}
