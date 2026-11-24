import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { PlayCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { useCockpit, useTenant, type BrainTab, type HubTab } from "@/lib/cockpit-store";
import { cycleOf, hubInsights, workbenchStats, freePlan } from "@/core";
import type { WorkbenchTab } from "@/tenants/schema";
import { TENANT_PACKS } from "@/tenants/registry";
import type { PersonaId } from "@/tenants/personas";
import { fmtUsd } from "@/core/format";
import { enabledAt, FEATURE_HORIZON, type FeatureKey } from "@/ui/horizon";

interface Step {
  title: string;
  say: string;
  go: { path: "/" | "/brain" | "/gallery" | "/roadmap" | "/portfolio" | "/health" | "/trust"; persona?: PersonaId; hubTab?: HubTab; wbTab?: WorkbenchTab; brainTab?: BrainTab; tenant?: string; wbSub?: string };
}

export function DemoScript() {
  const t = useTenant();
  const setUi = useCockpit((s) => s.setUi);
  const setTenant = useCockpit((s) => s.setTenant);
  const setPersona = useCockpit((s) => s.setPersona);
  const horizon = useCockpit((s) => s.horizon);
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState(0);

  const pack = t.pack;
  const free = freePlan(pack);
  const devInsights = hubInsights(t, "dev");
  const failed = t.hub.dev?.charges.find((c) => c.status === "failed" && c.meter);
  const paused = t.hub.maya?.runs.find((r) => r.status === "paused");
  const w = workbenchStats(pack);
  const other = TENANT_PACKS.find((x) => x.id !== pack.id);
  const { end } = cycleOf(t);
  const prepaid = pack.billingModel === "prepaid";

  const steps: Step[] = [
    {
      title: prepaid ? "Maya's run pauses when the trial runs dry" : `Maya hits the ${free?.name ?? "free"} cap mid-run`,
      say: paused
        ? `${paused.table} paused at row ${paused.done} of ${paused.rows}, nothing lost. Five ways on, each priced per credit: top up${pack.hub.starterPack ? " or a starter pack" : ""}, wait for the reset on ${end.toLocaleDateString("en-GB", { day: "numeric", month: "short" })}, own key, run fewer rows, or upgrade with the proration shown.`
        : `Add an enrichment column in Tables: the estimate shows the range, the free not-found share and the hold before anything is charged.`,
      go: { path: "/", persona: "maya", hubTab: "tables" },
    },
    {
      title: "Maya's lifecycle, stage by stage",
      say: "Signed up to converted, with the moment and the guardrail for each: no forced tour, one activation reward per domain, at most two nudges, opt-out honoured.",
      go: { path: "/", persona: "maya", hubTab: "lifecycle" },
    },
    {
      title: "Dev's Home: what needs attention, in order",
      say: devInsights.map((i) => i.title).slice(0, 1).join(". ") || "Moments are ordered by urgency, each with evidence and one action. Below: both meters, Today's Spark, plan fit and who on the team burned what.",
      go: { path: "/", persona: "dev", hubTab: "home" },
    },
    {
      title: "Why did this cost that?",
      say: "Usage by table, column, provider, model and member, Data Credits apart from Actions, and the cost per verified email against a gentle benchmark. Every run opens a drawer: rows, per-row cost, misses that were free, retries, holds released.",
      go: { path: "/", persona: "dev", hubTab: "usage" },
    },
    {
      title: "Estimate, hold, run, release",
      say: `On the ${pack.demo.hub.dev.table?.rows.toLocaleString("en-US") ?? "big"}-row table, the estimate shows the range and hold before the run; the run debits row by row and releases what it didn't use. With a cap of a few packs, auto top-up stops at the cap and asks before going further.`,
      go: { path: "/", persona: "dev", hubTab: "tables" },
    },
    {
      title: "Auto top-up with a cap Dev controls",
      say: "Threshold, amount, monthly cap, what happens at the cap, what happens if the card fails, and an \"I changed my mind\" pause that refunds an untouched top-up.",
      go: { path: "/", persona: "dev", hubTab: "topups" },
    },
    {
      title: "A Member asks; Dev approves in one tap",
      say: "Members without billing rights get Request credits with the reason, amount and cost filled in. Admins approve from e-mail, team chat or Home; every change lands in the audit log.",
      go: { path: "/", persona: "member", hubTab: "tables" },
    },
    {
      title: "Plan fit replays 90 days",
      say: "Every plan and meter size against the last 90 days: the cheapest fit and the one that never runs out. Monthly or annual, proration, effective date, a 24-hour undo, and existing terms protected.",
      go: { path: "/", persona: "dev", hubTab: "plan" },
    },
    {
      title: failed ? "Dev recovers a failed top-up" : "A failed card, a soft landing",
      say: "Brain → Clock → Payment states puts Dev into each state: card expiring, backup pays, renewal fails with credits still working through the grace window, grace ends. Exports are never blocked.",
      go: { path: "/brain", brainTab: "sim" },
    },
    {
      title: "Nia connects Clay and watches it learn",
      say: "Consent per source, seven lanes of real progress, Memory cards she can edit or forget, at most five questions, then five findings in one view and a Time to first experiment clock.",
      go: { path: "/", persona: "nia", wbTab: "start" },
    },
    {
      title: "The agent drives the tour in a sandbox",
      say: "Launch your first experiment: the agent opens Cohorts, picks the at-risk free cohort, asks Ask CB, picks a hypothesis, drafts the test and asks for approval. Take over at any step; only the approved launch goes live.",
      go: { path: "/", persona: "nia", wbTab: "start" },
    },
    {
      title: "Today and the cohort view",
      say: "MRR movements, credit economics, the free-to-paid funnel and the churn split, each drilling into a cohort; At risk and Thriving lanes with plain drivers and a retention heatmap by week.",
      go: { path: "/", persona: "nia", wbTab: "today" },
    },
    {
      title: "Ask CB with slash commands and approvals",
      say: "Answer first, evidence, confidence and Memory cards used; Show my work; /grant behind the ApprovalSheet with /undo; CB Daily 5 with its empty moment; a research analyst with citations.",
      go: { path: "/", persona: "nia", wbTab: "ask" },
    },
    {
      title: "The daily experiment, D1 to D7",
      say: "Pick today's recommended hypothesis and launch it. The Time machine moves the days: D1 never declares a winner, D3 is directional, D7 decides. A stop-loss pauses the 40% win-back on its own. Ship needs approval and keeps a revert.",
      go: { path: "/", persona: "nia", wbTab: "hypotheses" },
    },
    {
      title: "Churn arrest, plan personas, breakage and rewards",
      say: "Recover failed payments with levers and a Dunning Rescue agent; replay persona plans and test them on new customers only; fund upsell credits from breakage within finance's rule; reward good behaviour, never logins.",
      go: { path: "/", persona: "sam", wbTab: "breakage" },
    },
    {
      title: "Sam checks margin and breakage",
      say: `Gross margin ${Math.round(w.marginPct * 100)}%; ${fmtUsd(w.breakageUsd, 0)} of paid allowance expires unused this cycle.`,
      go: { path: "/", persona: "sam", wbTab: "economics" },
    },
    {
      title: "Dev bills from India or the EU",
      say: "Switch Dev's billing region in the Hub header: prices move to rupees with GST added or euros with VAT included, card payments ask for a one-time password or 3-D Secure, and auto top-up waits for a fresh consent.",
      go: { path: "/", persona: "dev", hubTab: "topups" },
    },
    {
      title: "Evals: the cheapest model that's just as good",
      say: "Company research scores 92 on the default model and 91 on the mid-tier model at 38% of the cost, inside the 2-point margin. Slide the scenario to see revenue per task fall while run-outs drop and margin rises; Create experiment puts it on the cohort that burns credits fastest.",
      go: { path: "/", persona: "nia", wbTab: "evals", wbSub: "rightsizing" },
    },
    {
      title: "The quality gate and its audited override",
      say: "Find work email's cheaper model fails: 5 points lower and contact accuracy under the bar. The experiment can't launch until someone approves an override with a reason. Canary evals keep checking after launch.",
      go: { path: "/", persona: "nia", wbTab: "evals", wbSub: "gate" },
    },
    {
      title: "One governed tool layer",
      say: "Eight MCP servers and 35 tools with tiers. grant_reward is capped at 50: an agent asking for 80 is refused. Writes always wait for an approver or a standing budget; every call is logged, masked and explainable.",
      go: { path: "/", persona: "nia", wbTab: "mcp", wbSub: "tools" },
    },
    {
      title: "An outside AI asks about credits",
      say: "A generic AI client on Dev's workspace calls get_balance then estimate_run_cost with a scoped token; turning on auto top-up goes to approval; Maya's balance is refused.",
      go: { path: "/", persona: "nia", wbTab: "mcp", wbSub: "external" },
    },
    {
      title: "Agents, and the switch that stops them",
      say: "Nine agents with a trigger, autonomy and success metric each, making real tool calls. Run one, read its trace, then flip the global kill switch.",
      go: { path: "/", persona: "nia", wbTab: "agents" },
    },
    {
      title: "A portal experience from plain words",
      say: "Describe a moment; see the definition and a plain summary side by side, preview it on real accounts, publish v1, revise to v2, roll back.",
      go: { path: "/", persona: "nia", wbTab: "experiences" },
    },
    {
      title: "The hub inside the tenant's app",
      say: "The embed snippet, then the mock app: Credits opens the hub modules as a drawer or a modal, hosted or embedded, with event hooks.",
      go: { path: "/", persona: "nia", wbTab: "embed" },
    },
    {
      title: "What ships first, and the product's own health",
      say: "Three release lanes, maturity and kill switches per module, the portfolio and dependency map, and the north-star metric with its inputs and guardrails.",
      go: { path: "/roadmap" },
    },
    {
      title: "Everything above is one ledger",
      say: "Grants by source, debits, holds, releases, rollovers, expiries and reversals: append-only entries with a reason, an actor and an idempotency key, in a hash chain. Rewards and promos are spent first, top-ups last.",
      go: { path: "/brain", brainTab: "ledger" },
    },
    {
      title: "Move the clock",
      say: "The clock advances the day: holds settle and release the difference, schedules run, lots expire, and at renewal plan credits roll over up to the cap.",
      go: { path: "/brain", brainTab: "sim" },
    },
    {
      title: "2,000 workspaces, 90 days",
      say: "A seeded population shows the mix behind the numbers: most AI research stays on the most expensive default model, free workspaces go quiet or never start, and cohort tables are saved with the run.",
      go: { path: "/brain", brainTab: "population" },
    },
    {
      title: "Proof: the acceptance checks",
      say: "Ledger rules, forecasts, simulator determinism, tenant switching and region rules run live here and under the test runner.",
      go: { path: "/brain", brainTab: "checks" },
    },
    ...(other
      ? [
          {
            title: `Swap the Tenant Pack to ${other.company}`,
            say: `Same cockpit, different business: ${other.meters.map((m) => m.label).join(" and ")}, ${other.billingModel === "prepaid" ? "prepaid" : "subscription"} billing, for ${other.category.toLowerCase()}.`,
            go: { path: "/brain" as const, brainTab: "pack" as BrainTab, tenant: other.id },
          },
        ]
      : []),
  ];

  const go = (i: number) => {
    const s = steps[i];
    if (s.go.tenant) setTenant(s.go.tenant);
    const { path, persona, hubTab, wbTab, brainTab, wbSub } = s.go;
    if (persona) setPersona(persona);
    const feature = (hubTab ? `hub.${hubTab}` : wbTab ? `wb.${wbTab}` : null) as FeatureKey | null;
    const need = feature && feature in FEATURE_HORIZON && !enabledAt(horizon, feature) ? FEATURE_HORIZON[feature] : null;
    setUi({
      ...(need ? { horizon: need } : {}),
      ...(hubTab ? { hubTab } : {}),
      ...(wbTab ? { wbTab } : {}),
      ...(brainTab ? { brainTab } : {}),
      wbSub: wbSub ?? null,
    });
    navigate(path);
    setCurrent(i);
    setOpen(false);
  };

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button size="sm" variant="secondary" className="h-8">
          <PlayCircle aria-hidden="true" />
          Demo script
        </Button>
      </SheetTrigger>
      <SheetContent className="w-full overflow-y-auto sm:max-w-md">
        <SheetHeader>
          <SheetTitle>Demo script · {pack.company}</SheetTitle>
          <SheetDescription>{steps.length} steps. Each one switches persona, tab and horizon for you.</SheetDescription>
        </SheetHeader>
        <ol className="space-y-1 px-4 pb-4">
          {steps.map((s, i) => (
            <li key={s.title}>
              <button
                type="button"
                onClick={() => go(i)}
                aria-current={i === current ? "step" : undefined}
                className="flex w-full gap-3 rounded-lg p-3 text-left hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring aria-[current=step]:bg-muted"
              >
                <span className="flex size-6 shrink-0 items-center justify-center rounded-full border border-control-border text-xs font-semibold tabular-nums">
                  {i + 1}
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-semibold">{s.title}</span>
                  <span className="mt-0.5 block text-sm text-muted-foreground">{s.say}</span>
                </span>
              </button>
            </li>
          ))}
        </ol>
      </SheetContent>
    </Sheet>
  );
}
