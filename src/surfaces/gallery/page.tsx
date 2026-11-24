import { useMemo, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ThemeToggle, useTheme } from "@/components/theme-toggle";
import { useTenant } from "@/lib/cockpit-store";
import { SectionTitle } from "@/ui/primitives";
import { MeterBar } from "@/ui/meter-bar";
import { CreditChip } from "@/ui/credit-chip";
import { BalanceCard } from "@/ui/balance-card";
import { ForecastLine } from "@/ui/forecast-line";
import { LedgerTable } from "@/ui/ledger-table";
import { MomentCard } from "@/ui/moment-card";
import { ApprovalSheet } from "@/ui/approval-sheet";
import { AgentNarrator, type NarratorStep } from "@/ui/agent-narrator";
import { ScoreCard } from "@/ui/score-card";
import { CohortHeatmap } from "@/ui/cohort-heatmap";
import { HypothesisCard } from "@/ui/hypothesis-card";
import { ToolCallTrace } from "@/ui/tool-call-trace";
import { TONE_NAME, TONE_SOFT, ToneBadge } from "@/ui/tone";
import { blockMoment, cohortDefs, cycleOf, grantPromo, meterTimeline, monthlyAllowance, packsFor, primaryMeter, sampleReasons, auditId, type Tone } from "@/core";
import type { ToolCall } from "@/mcp/types";
import { MoneyProvider } from "@/ui/money";
import { regionById } from "@/tenants/regions";
import { RecurringConsent, RenewalDisclosure, StrongAuthDialog } from "@/surfaces/credits-hub/payments";
import { GALLERY_STATES, GALLERY_STATE_COUNT } from "@/surfaces/gallery/coverage";
import { amountText } from "@/core/format";
import { activationScorecard, retentionHeatmap } from "@/sim/series";
import { callTool } from "@/mcp/registry";
import { packDiff, packRisk } from "@/agents/onboarding";
import { cn } from "@/lib/utils";

type Prop = [name: string, type: string, note: string];

interface Doc {
  id: string;
  name: string;
  purpose: string;
  props: Prop[];
  example: ReactNode;
  /** One tile per state listed in GALLERY_STATES for this component. */
  states: Record<string, ReactNode>;
  file?: string;
  wide?: boolean;
}

const NEUTRALS = [
  ["background", "bg-background"],
  ["card", "bg-card"],
  ["muted", "bg-muted"],
  ["border", "bg-border"],
  ["muted-foreground", "bg-muted-foreground"],
  ["foreground", "bg-foreground"],
  ["primary (accent)", "bg-primary"],
] as const;

const TONES: Tone[] = ["healthy", "watch", "atRisk", "blocked", "reward", "info", "neutral"];
const SOLID: Record<Tone, string> = {
  healthy: "bg-healthy",
  watch: "bg-watch",
  atRisk: "bg-at-risk",
  blocked: "bg-blocked",
  reward: "bg-reward",
  info: "bg-info",
  neutral: "bg-muted-foreground",
};

const TYPE = [
  ["type-display", "30 / 36 · semibold · tabular", "12,480 left"],
  ["type-title", "20 / 28 · semibold", "Credits Hub"],
  ["type-heading", "16 / 24 · semibold", "Top-up packs"],
  ["type-body", "14 / 20", "Runs out on 25 Nov at today's pace."],
  ["type-caption", "12 / 16", "Ledger · Data Credits reached 0"],
] as const;

const SPACE = [1, 2, 3, 4, 6, 8, 12] as const;

export function GalleryPage() {
  const t = useTenant();
  const theme = useTheme();
  const pack = t.pack;
  const m = primaryMeter(pack);
  const tl = useMemo(() => meterTimeline(t, "dev", m.id), [t, m.id]);
  const { day } = cycleOf(t);
  const heat = useMemo(() => retentionHeatmap(t), [t]);
  const score = useMemo(() => activationScorecard(t), [t]);
  const calls = useMemo(() => [callTool("ledger.get_balance", { account: "dev" }, t), callTool("usage.forecast", { account: "dev", meter: m.id }, t), callTool("cohorts.list", {}, t)], [t, m.id]);
  const exp = t.experiments.find((e) => e.arms.length >= 2) ?? t.experiments[0];
  const cohortLabel = exp ? (cohortDefs(pack).find((c) => c.id === exp.cohort)?.label ?? exp.cohort) : "";
  const [sheet, setSheet] = useState<null | "low" | "medium" | "high">(null);
  const [prompt, setPrompt] = useState<null | { region: string; usd: number; cardCheck?: boolean }>(null);
  const [narr, setNarr] = useState<{ i: number; over: boolean }>({ i: 2, over: false });
  const steps: NarratorStep[] = ["Read the tenant", "Draft a change", "Validate", "Simulate", "Wait for approval"].map((label, i) => ({
    id: String(i),
    label,
    status: i < narr.i ? "done" : i === narr.i ? "running" : "pending",
    by: i === 1 ? "agent" : i === 4 ? "you" : "tool",
    detail: i < narr.i ? "Finished" : undefined,
  }));
  const ts = useMemo(() => new Date().toISOString(), []);
  const allowance = monthlyAllowance(pack, pack.demo.hub.dev.planId, m.id) || (m.valueType === "currency" ? 250 : 1000);
  const healthy = useMemo(() => grantPromo(t, "maya", m.id, allowance * 5, "Gallery fixture", "merchant:gallery").state, [t, m.id, allowance]);
  const tlHealthy = useMemo(() => meterTimeline(healthy, "maya", m.id), [healthy, m.id]);
  const tlOut = useMemo(() => meterTimeline(t, "maya", m.id), [t, m.id]);
  const devLedger = t.ledger.filter((e) => e.account === "dev").slice(-30);
  const fixedSteps = (kind: "working" | "failed" | "over" | "done"): NarratorStep[] =>
    ["Read the tenant", "Draft a change", "Validate", "Simulate"].map((label, i) => ({
      id: `${kind}-${i}`,
      label,
      by: i === 1 ? "agent" : "tool",
      status: kind === "done" ? "done" : kind === "failed" ? (i < 2 ? "done" : i === 2 ? "failed" : "skipped") : kind === "over" ? (i < 2 ? "done" : "pending") : i < 1 ? "done" : i === 1 ? "running" : "pending",
      detail: kind === "failed" && i === 2 ? "2 issues: unknown meter in plans.1" : undefined,
    }));
  const lane = (label: string, node: ReactNode) => ({ [label]: node });
  const riskFor = (level: "low" | "medium" | "high") =>
    level === "low" ? { level, reasons: ["Copy-only change"] } : level === "medium" ? { level, reasons: ["Changes a grant rule", "Affects 140 paid workspaces"] } : packRisk(pack, null).level === "high" ? packRisk(pack, null) : { level, reasons: ["Raises prices for existing customers", "Turns off rollover"] };
  const okCalls: ToolCall[] = calls;
  const badCalls: ToolCall[] = [
    { id: "x1", tool: "tenant.validate_pack", args: { pack: "…" }, status: "error", ms: 41, summary: "3 issues" },
    { id: "x2", tool: "sim.preview_pack", args: { pack: "…" }, status: "running", ms: 0, summary: "" },
  ];
  const reasons = sampleReasons(pack);
  const regionNode = (id: string, node: ReactNode) => <MoneyProvider region={regionById(id)}>{node}</MoneyProvider>;
  const planP = pack.plans.find((p) => p.paid && p.price) ?? pack.plans[0];
  const bigPack = packsFor(pack, m.id).slice(-1)[0];

  const docs: Doc[] = [
    {
      id: "meter-bar",
      name: "MeterBar",
      purpose: "Used · held · remaining · expiring-soon as one bar over everything available this cycle.",
      props: [
        ["meter", "Meter", "From the Tenant Pack; sets units and currency formatting"],
        ["used / held / remaining / expiring", "number", "Ledger-derived amounts"],
        ["compact", "boolean?", "Hide the legend; values stay in the accessible name"],
      ],
      example: <MeterBar meter={m} used={tl.used} held={tl.held} remaining={tl.balance} expiring={tl.expiring.amount} />,
      states: {
        "Plenty left": <MeterBar meter={m} used={allowance * 0.2} held={0} remaining={allowance * 0.8} expiring={0} />,
        "Held and expiring": <MeterBar meter={m} used={allowance * 0.4} held={allowance * 0.15} remaining={allowance * 0.45} expiring={allowance * 0.2} />,
        "Running low": <MeterBar meter={m} used={allowance * 0.92} held={0} remaining={allowance * 0.08} expiring={0} />,
        Empty: <MeterBar meter={m} used={allowance} held={0} remaining={0} expiring={0} />,
        Compact: <MeterBar meter={m} used={allowance * 0.2} held={0} remaining={allowance * 0.8} expiring={0} compact />,
      },
    },
    {
      id: "credit-chip",
      name: "CreditChip",
      purpose: "An amount in a meter's own unit, signed for ledger movements.",
      props: [
        ["meter", "Meter", "Unit and decimals"],
        ["amount", "number", "Value to show"],
        ["signed", "boolean?", "Show + for credits and − for debits"],
      ],
      example: <CreditChip meter={m} amount={m.valueType === "currency" ? 25 : 500} />,
      states: {
        "Each meter": (
          <div className="flex flex-wrap gap-2">
            {pack.meters.map((x) => (
              <CreditChip key={x.id} meter={x} amount={x.valueType === "currency" ? 25 : 500} />
            ))}
          </div>
        ),
        "Signed debit": <CreditChip meter={m} amount={-12.5} signed />,
        "Signed credit": <CreditChip meter={m} amount={40} signed />,
        Zero: <CreditChip meter={m} amount={0} />,
      },
    },
    {
      id: "balance-card",
      name: "BalanceCard",
      purpose: "One meter's balance: the number, status, MeterBar and burn forecast. The Credits Hub's main card.",
      props: [
        ["t", "TenantState", "Live tenant"],
        ["personaId", '"maya" | "dev"', "Whose balance"],
        ["meter", "Meter", "Which meter"],
        ["onTopUp", "() => void?", "Shows the Top up / Add funds button"],
        ["compact", "boolean?", "Drop the forecast (Crawl horizon)"],
      ],
      example: <BalanceCard t={t} personaId="dev" meter={m} onTopUp={() => toast("The Hub opens Top-ups here.")} />,
      wide: true,
      states: {
        "Lasts the cycle": <BalanceCard t={healthy} personaId="maya" meter={m} compact />,
        "Runs out early": <BalanceCard t={t} personaId="dev" meter={m} compact onTopUp={() => toast("Top up")} />,
        "Ran out": <BalanceCard t={t} personaId="maya" meter={m} compact onTopUp={() => toast("Top up")} />,
        Compact: <BalanceCard t={t} personaId="dev" meter={pack.meters[pack.meters.length - 1]} compact />,
      },
    },
    {
      id: "forecast-line",
      name: "ForecastLine",
      purpose: "Cumulative use, the weekday-weighted projection with an 80% band, what's available and the run-out day. Has a data-table fallback.",
      props: [
        ["meter", "Meter", "Axis units"],
        ["timeline", "MeterTimeline", "From meterTimeline(t, account, meter)"],
        ["today", "number", "Cycle day index"],
        ["titleId / summaryId", "string", "Labelled-by and described-by ids"],
        ["height / showTable", "number? / boolean?", "Size; table toggle"],
      ],
      example: (
        <div>
          <h3 id="g-fl-title" className="sr-only">
            Dev's {m.label} forecast
          </h3>
          <p id="g-fl-sum" className="sr-only">
            Cumulative use against what is available this cycle.
          </p>
          <ForecastLine meter={m} timeline={tl} today={day} titleId="g-fl-title" summaryId="g-fl-sum" />
          <p className="mt-1 type-caption text-muted-foreground">
            {tl.rate} a day (trailing 7 days, weekday-weighted) · {tl.confidence} confidence · weights Sun–Sat {tl.weights.map((w) => w.toFixed(2)).join(" ")}
          </p>
        </div>
      ),
      wide: true,
      states: Object.assign(
        {},
        ...(
          [
            ["Lasts the cycle", tlHealthy],
            ["Runs out early", tl],
            ["Ran out", tlOut],
          ] as const
        ).map(([label, x], i) =>
          lane(
            label,
            <div>
              <h4 id={`g-fls-${i}`} className="sr-only">{label}</h4>
              <p id={`g-fls-${i}-s`} className="sr-only">{label} forecast</p>
              <ForecastLine meter={m} timeline={x} today={day} titleId={`g-fls-${i}`} summaryId={`g-fls-${i}-s`} height={130} showTable={false} />
            </div>,
          ),
        ),
      ),
    },
    {
      id: "ledger-table",
      name: "LedgerTable",
      purpose: "The append-only ledger, newest first, filterable by kind; each row carries its source, reason code, actor and idempotency key.",
      props: [
        ["pack", "TenantPack", "Meter labels and formatting"],
        ["entries", "LedgerEntry[]", "Rows (oldest first; shown reversed)"],
        ["accountName", "(id) => string?", "Display names"],
        ["onReverse / reversed", "(entry) => void? / Set<string>?", "Adds a Reverse action; marks reversed entries"],
        ["pageSize / dense / caption", "number? / boolean? / string?", "Paging and density"],
      ],
      example: <LedgerTable pack={pack} entries={devLedger} accountName={(x) => (x === "dev" ? "Dev" : "Maya")} pageSize={6} />,
      wide: true,
      states: {
        Full: <LedgerTable pack={pack} entries={devLedger} accountName={(x) => (x === "dev" ? "Dev" : "Maya")} pageSize={3} />,
        Dense: <LedgerTable pack={pack} entries={devLedger} pageSize={3} dense />,
        "With reverse": <LedgerTable pack={pack} entries={devLedger} pageSize={3} onReverse={(e) => toast(`Reverse entry ${e.seq}`)} />,
        Empty: <LedgerTable pack={pack} entries={[]} pageSize={3} dense />,
      },
    },
    {
      id: "moment-card",
      name: "MomentCard",
      purpose: "The designed-moment container: trigger, headline, evidence, actions and a dismiss reason. Blocked runs render from a typed BlockReason.",
      props: [
        ["tone", "Tone", "Semantic colour"],
        ["trigger", "string", "What fired it, e.g. a ledger or forecast signal"],
        ["headline / evidence", "string / ReactNode", "The message and the numbers behind it"],
        ["primary / secondary", "MomentAction?", "Label, onClick, disabled, hint"],
        ["onDismiss / dismissReasons", "(reason) => void? / string[]?", "Dismiss with a reason"],
        ["blockMoment(pack, reason)", "BlockMoment", "Typed reason → tone, trigger, headline, evidence, action"],
      ],
      example: (
        <MomentCard
          tone="atRisk"
          trigger={`Forecast · ${m.label} trend`}
          headline={tl.runsOutDay != null ? `Dev's ${m.label} run out around day ${tl.runsOutDay + 1}` : `Dev's ${m.label} last the cycle`}
          evidence={<span>Using {amountText(m, tl.rate)} a day with {amountText(m, tl.balance)} left.</span>}
          primary={{ label: "Top up", onClick: () => toast("Primary action") }}
          secondary={{ label: "Set a budget", onClick: () => toast("Secondary action") }}
          onDismiss={(r) => toast(`Dismissed: ${r}`)}
        />
      ),
      wide: true,
      states: {
        "Forecast (at risk)": <MomentCard tone="atRisk" trigger="Forecast · run-out before reset" headline={`${m.label} run out in 4 days`} evidence="At today's pace, with a weekday-weighted band." primary={{ label: "Top up", onClick: () => toast("Top up") }} onDismiss={() => undefined} />,
        "Payment failed (blocked)": <MomentCard tone="blocked" trigger="Payments · top-up declined" headline="Auto top-up failed" evidence="Card ending 1009 expired." primary={{ label: "Replace card", onClick: () => toast("Replace card") }} />,
        "Expiring (watch)": <MomentCard tone="watch" trigger="Ledger · lots expiring" headline={`${amountText(m, allowance * 0.2)} expire on Friday`} evidence="Plan credits soonest to expire are used first." />,
        Reward: <MomentCard tone="reward" trigger="Rewards · ready to claim" headline={pack.rewards[0] ? `${pack.rewards[0].label}: +${amountText(m, pack.rewards[0].amount)}` : "Reward ready"} evidence="Reward credits are spent first." primary={{ label: "Claim", onClick: () => toast("Claim") }} />,
        "Disabled action with hint": <MomentCard tone="info" trigger="Payments · retry" headline="Retry needs a valid card" evidence="Replace the card in Billing first." primary={{ label: "Retry", onClick: () => undefined, disabled: true, hint: "Retry needs a valid card" }} />,
        ...Object.fromEntries(
          reasons.map((r) => {
            const bm = blockMoment(pack, r);
            return [`Run blocked · ${r.code}`, <MomentCard key={r.code} tone={bm.tone} trigger={bm.trigger} headline={bm.headline} evidence={bm.evidence} primary={{ label: bm.action.label, onClick: () => toast(bm.action.kind) }} />];
          }),
        ),
      },
    },
    {
      id: "approval-sheet",
      name: "ApprovalSheet",
      purpose: "Preview, diff, risk and an audit id: what a person needs before approving an agent's change.",
      props: [
        ["open / onOpenChange", "boolean / (open) => void", "Controlled sheet"],
        ["title / description / preview", "string / string / ReactNode", "What is being approved"],
        ["diff", "DiffRow[]", "path, before, after"],
        ["risk", "{ level, reasons }", "low · medium · high with the rules that fired"],
        ["auditId", "string", "Derived from the subject and time"],
        ["onApprove / onReject", "() => void", "Decisions"],
      ],
      example: (
        <>
          <Button size="sm" variant="outline" onClick={() => setSheet("high")}>
            Open an approval for {pack.company}'s pack
          </Button>
          {sheet && (
            <ApprovalSheet
              open
              onOpenChange={(o) => !o && setSheet(null)}
              title={`Reload ${pack.company}?`}
              description="Gallery example. Approve and Reject only close the sheet."
              preview={<p className="type-body">{pack.meters.length} meters, {pack.plans.length} plans.</p>}
              diff={packDiff(null, pack).slice(0, 6)}
              risk={riskFor(sheet)}
              auditId={auditId(pack.id, ts)}
              onApprove={() => setSheet(null)}
              onReject={() => setSheet(null)}
            />
          )}
        </>
      ),
      states: Object.fromEntries(
        (["low", "medium", "high"] as const).map((lv) => [
          `${lv[0].toUpperCase()}${lv.slice(1)} risk`,
          <Button key={lv} size="xs" variant="outline" onClick={() => setSheet(lv)}>
            Open · {lv} risk
          </Button>,
        ]),
      ),
    },
    {
      id: "agent-narrator",
      name: "AgentNarrator",
      purpose: "An agent's plan as steps with live status and who did each (agent, tool or you), plus take-over and undo.",
      props: [
        ["steps", "NarratorStep[]", "id, label, status, detail, by"],
        ["running / takenOver / canUndo", "boolean", "Controls"],
        ["onTakeOver / onUndo", "() => void?", "Hand control to the person; step back"],
        ["live", "string?", "Polite live-region narration"],
      ],
      example: (
        <div className="space-y-2">
          <AgentNarrator
            steps={steps}
            running={narr.i < 5 && !narr.over}
            takenOver={narr.over}
            canUndo={narr.i > 0}
            onTakeOver={() => setNarr({ ...narr, over: true })}
            onUndo={() => setNarr({ i: Math.max(0, narr.i - 1), over: narr.over })}
          />
          <Button size="xs" variant="ghost" onClick={() => setNarr({ i: Math.min(5, narr.i + 1), over: false })}>
            Advance one step
          </Button>
        </div>
      ),
      states: {
        Working: <AgentNarrator steps={fixedSteps("working")} running takenOver={false} canUndo={false} />,
        "Failed step": <AgentNarrator steps={fixedSteps("failed")} running={false} takenOver={false} canUndo />,
        "Taken over": <AgentNarrator steps={fixedSteps("over")} running={false} takenOver canUndo />,
        Finished: <AgentNarrator steps={fixedSteps("done")} running={false} takenOver={false} canUndo />,
      },
    },
    {
      id: "score-card",
      name: "ScoreCard",
      purpose: "Activation milestones reached by day 1, 3 and 7 for a signup cohort.",
      props: [
        ["title", "string", "Caption"],
        ["size", "number", "Accounts in the cohort"],
        ["rows", "ScoreRow[]", "From activationScorecard(t)"],
      ],
      example: <ScoreCard title={`${pack.company} signups, last 4 weeks`} size={score.size} rows={score.rows} />,
      states: {
        Populated: <ScoreCard title="Signups, last 2 weeks" size={score.size} rows={score.rows.slice(0, 2)} />,
        "No signups": <ScoreCard title="Signups this week" size={0} rows={[]} />,
      },
    },
    {
      id: "cohort-heatmap",
      name: "CohortHeatmap",
      purpose: "Weekly retention by signup week; each cell carries its value as text, not colour alone.",
      props: [
        ["columns", "string[]", "Week labels"],
        ["rows", "HeatRow[]", "From retentionHeatmap(t)"],
        ["caption", "string", "Table caption"],
      ],
      example: <CohortHeatmap columns={heat.columns} rows={heat.rows} caption={`${pack.company} weekly retention by signup week`} />,
      states: {
        "Weekly retention": <CohortHeatmap columns={heat.columns.slice(0, 4)} rows={heat.rows.slice(-4).map((r) => ({ ...r, cells: r.cells.slice(0, 4) }))} caption="Last 4 signup weeks" />,
        "No cohorts": <CohortHeatmap columns={heat.columns} rows={[]} caption="Retention by signup week" />,
      },
    },
    {
      id: "hypothesis-card",
      name: "HypothesisCard",
      purpose: "One experiment at a glance: status, the bet, cohort, metric and the result so far.",
      props: [
        ["e", "Experiment", "From the tenant's experiments"],
        ["cohortLabel", "string", "Human cohort name"],
        ["onOpen", "() => void?", "Open the full read-out"],
      ],
      example: exp ? <HypothesisCard e={exp} cohortLabel={cohortLabel} onOpen={() => toast("The Workbench opens the read-out here.")} /> : <p className="type-body text-muted-foreground">This tenant has no experiments.</p>,
      states: exp
        ? {
            Draft: <HypothesisCard e={{ ...exp, status: "draft", decision: undefined, startedAt: null, arms: exp.arms.map((a) => ({ ...a, exposed: 0, converted: 0 })) }} cohortLabel={cohortLabel} />,
            Running: <HypothesisCard e={{ ...exp, status: "running", decision: undefined }} cohortLabel={cohortLabel} />,
            Shipped: <HypothesisCard e={{ ...exp, status: "done", decision: "ship" }} cohortLabel={cohortLabel} />,
            Stopped: <HypothesisCard e={{ ...exp, status: "done", decision: "stop" }} cohortLabel={cohortLabel} />,
          }
        : {},
    },
    {
      id: "tool-call-trace",
      name: "ToolCallTrace",
      purpose: "Every MCP tool an agent called: name, arguments, result summary, status and latency.",
      props: [
        ["calls", "ToolCall[]", "From callTool(name, args, state)"],
        ["empty", "string?", "Empty-state text"],
      ],
      example: <ToolCallTrace calls={calls} />,
      states: {
        Calls: <ToolCallTrace calls={okCalls.slice(0, 2)} />,
        "Error and running": <ToolCallTrace calls={badCalls} />,
        "No calls": <ToolCallTrace calls={[]} />,
      },
    },
    {
      id: "payment-prompt",
      name: "PaymentPrompt",
      file: "surfaces/credits-hub/payments.tsx",
      purpose: "The region's strong-authentication step before a card payment, with the tax breakdown. Simulated: no card details or codes are collected.",
      props: [
        ["region", "RegionPack", "strongAuth: method, exemptBelow, copy"],
        ["req", "{ usd, label, cardCheck? }", "Net amount in USD; converted with tax"],
        ["onDecide", "(ok, note) => void", "Approve runs the payment; cancel charges nothing"],
      ],
      example: <p className="type-body text-muted-foreground">Opens from Buy, Upgrade, Retry and Replace card in the Credits Hub when the account's region needs it.</p>,
      states: {
        "EU 3-D Secure": (
          <Button size="xs" variant="outline" onClick={() => setPrompt({ region: "eu", usd: bigPack?.price ?? 97.5 })}>
            Open · EU
          </Button>
        ),
        "India one-time password": (
          <Button size="xs" variant="outline" onClick={() => setPrompt({ region: "in", usd: bigPack?.price ?? 97.5 })}>
            Open · India
          </Button>
        ),
        "Card check": (
          <Button size="xs" variant="outline" onClick={() => setPrompt({ region: "eu", usd: 0, cardCheck: true })}>
            Open · card check
          </Button>
        ),
      },
    },
    {
      id: "recurring-consent",
      name: "RecurringConsent",
      file: "surfaces/credits-hub/payments.tsx",
      purpose: "Recurring-payment consent before auto top-up, in the region's words; India adds the e-mandate limit.",
      props: [
        ["amountUsd", "number", "Each automatic charge, net USD"],
        ["checked / onChange", "boolean / (v) => void", "The consent box"],
        ["error", "string?", "Shown when saving without consent"],
        ["region", "RegionPack?", "Defaults to the Hub's billing region"],
      ],
      example: <RecurringConsent region={regionById("us")} amountUsd={bigPack?.price ?? 97.5} company={pack.company} checked={false} onChange={() => undefined} />,
      states: {
        "United States": <RecurringConsent region={regionById("us")} amountUsd={bigPack?.price ?? 97.5} company={pack.company} checked onChange={() => undefined} />,
        "European Union": <RecurringConsent region={regionById("eu")} amountUsd={bigPack?.price ?? 97.5} company={pack.company} checked={false} onChange={() => undefined} />,
        "India over the mandate limit": <RecurringConsent region={regionById("in")} amountUsd={250} company={pack.company} checked={false} onChange={() => undefined} />,
        "Not ticked (error)": <RecurringConsent region={regionById("eu")} amountUsd={bigPack?.price ?? 97.5} company={pack.company} checked={false} onChange={() => undefined} error="Tick the box to authorise automatic charges in European Union." />,
      },
    },
    {
      id: "renewal-disclosure",
      name: "RenewalDisclosure",
      file: "surfaces/credits-hub/payments.tsx",
      purpose: "The auto-renewal disclosure on Plan and Billing, priced under the region's tax display.",
      props: [
        ["planName / priceUsd / date", "string / number | null / string", "What renews, for how much, when"],
        ["company", "string", "Who charges"],
      ],
      example: regionNode("us", <RenewalDisclosure planName={planP.name} priceUsd={planP.price} date="23 Dec" company={pack.company} />),
      states: {
        "United States": regionNode("us", <RenewalDisclosure planName={planP.name} priceUsd={planP.price} date="23 Dec" company={pack.company} />),
        "European Union": regionNode("eu", <RenewalDisclosure planName={planP.name} priceUsd={planP.price} date="23 Dec" company={pack.company} />),
        India: regionNode("in", <RenewalDisclosure planName={planP.name} priceUsd={planP.price} date="23 Dec" company={pack.company} />),
      },
    },
  ];

  return (
    <div className="mx-auto max-w-[1200px] space-y-10 px-4 py-5 sm:px-6 sm:py-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="type-title">Component gallery</h1>
          <p className="type-body text-muted-foreground">
            Tokens and the {docs.length} cockpit components in {GALLERY_STATE_COUNT} states, rendered with the active tenant ({pack.company}).
          </p>
        </div>
        <div className="flex items-center gap-2 type-caption text-muted-foreground">
          Theme: {theme}
          <ThemeToggle className="border border-border" />
        </div>
      </div>

      <nav aria-label="Gallery contents" className="flex flex-wrap gap-1.5">
        {[{ id: "tokens", name: "Tokens" }, ...docs].map((d) => (
          <a key={d.id} href={`#g-${d.id}`} className="rounded-md border border-border px-2 py-1 type-caption hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring">
            {d.name}
          </a>
        ))}
      </nav>

      <section id="g-tokens" aria-labelledby="tokens-title" className="scroll-mt-16 space-y-6">
        <SectionTitle id="tokens-title">Tokens</SectionTitle>
        <div className="grid gap-6 lg:grid-cols-2">
          <div className="space-y-3">
            <h3 className="type-heading">Warm neutrals and one accent</h3>
            <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {NEUTRALS.map(([name, cls]) => (
                <li key={name} className="flex items-center gap-2">
                  <span aria-hidden="true" className={cn("size-8 shrink-0 rounded-md border border-border", cls)} />
                  <span className="font-mono type-caption">{name}</span>
                </li>
              ))}
            </ul>
          </div>
          <div className="space-y-3">
            <h3 className="type-heading">Semantic tones</h3>
            <ul className="grid gap-2 sm:grid-cols-2">
              {TONES.map((tone) => (
                <li key={tone} className={cn("flex items-center gap-2 rounded-lg border px-2 py-1.5", TONE_SOFT[tone])}>
                  <span aria-hidden="true" className={cn("size-4 shrink-0 rounded-full", SOLID[tone])} />
                  <span className="type-caption font-medium">{TONE_NAME[tone]}</span>
                  <ToneBadge tone={tone} className="ml-auto">
                    {tone}
                  </ToneBadge>
                </li>
              ))}
            </ul>
          </div>
          <div className="space-y-3">
            <h3 className="type-heading">Type scale (tabular numerals)</h3>
            <ul className="space-y-2">
              {TYPE.map(([cls, spec, sample]) => (
                <li key={cls} className="flex flex-wrap items-baseline gap-x-3">
                  <span className={cn(cls, "num")}>{sample}</span>
                  <span className="font-mono type-caption text-muted-foreground">
                    .{cls} · {spec}
                  </span>
                </li>
              ))}
            </ul>
          </div>
          <div className="space-y-3">
            <h3 className="type-heading">4-point spacing</h3>
            <ul className="space-y-1.5">
              {SPACE.map((n) => (
                <li key={n} className="flex items-center gap-3">
                  <span className="w-16 font-mono type-caption text-muted-foreground">
                    {n * 4}px
                  </span>
                  <span aria-hidden="true" className="h-3 rounded-sm bg-primary" style={{ width: n * 4 }} />
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {docs.map((d) => (
        <section key={d.id} id={`g-${d.id}`} aria-labelledby={`g-${d.id}-title`} className="scroll-mt-16 space-y-3 border-t border-border pt-6">
          <SectionTitle id={`g-${d.id}-title`} aside={<span className="font-mono">{d.file ?? `ui/${d.id}.tsx`}</span>}>
            {d.name}
          </SectionTitle>
          <p className="type-body text-muted-foreground">{d.purpose}</p>
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
            <div className="min-w-0 rounded-xl border border-dashed border-border p-3 sm:p-4">{d.example}</div>
            <Table>
              <TableCaption className="sr-only">{d.name} props</TableCaption>
              <TableHeader>
                <TableRow>
                  <TableHead scope="col">Prop</TableHead>
                  <TableHead scope="col">Type</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {d.props.map(([name, type, note]) => (
                  <TableRow key={name}>
                    <TableHead scope="row" className="align-top font-mono type-caption font-normal whitespace-normal">
                      {name}
                    </TableHead>
                    <TableCell className="align-top whitespace-normal">
                      <div className="font-mono type-caption">{type}</div>
                      <div className="type-caption text-muted-foreground">{note}</div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <div className="space-y-2">
            <h3 className="type-caption font-semibold uppercase tracking-wide text-muted-foreground">
              States · {(GALLERY_STATES[d.name] ?? []).length}
            </h3>
            <ul className={cn("grid gap-3", d.wide ? "lg:grid-cols-2" : "sm:grid-cols-2 xl:grid-cols-3")}>
              {(GALLERY_STATES[d.name] ?? []).map((label) => (
                <li key={label} className="min-w-0 space-y-2 rounded-lg border border-border p-3">
                  <div className="type-caption font-medium text-muted-foreground">{label}</div>
                  {d.states[label] ?? <ToneBadge tone="blocked">Not rendered</ToneBadge>}
                </li>
              ))}
            </ul>
          </div>
        </section>
      ))}
      {prompt && (
        <StrongAuthDialog
          region={regionById(prompt.region)}
          company={pack.company}
          req={{ usd: prompt.usd, label: prompt.cardCheck ? "New card" : `${bigPack ? amountText(m, bigPack.units) : "Top-up"} top-up`, cardCheck: prompt.cardCheck }}
          onDecide={(ok) => {
            toast(ok ? "Approved (gallery: nothing charged)." : "Cancelled.");
            setPrompt(null);
          }}
        />
      )}
    </div>
  );
}

export default GalleryPage;
