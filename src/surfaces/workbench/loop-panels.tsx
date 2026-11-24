// Phase 5 panels around the loop: involuntary churn arrest (§5.7), persona plans and the plan
// variant replay (§5.8), the breakage pool with its finance rule (§5.9) and the rewards studio
// with the abuse monitor (§5.10).
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Bot, Coins, FlaskConical, Landmark, Megaphone, Plus, ShieldAlert } from "lucide-react";
import type { RewardRule } from "@/growth/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ApprovalSheet } from "@/ui/approval-sheet";
import { SectionTitle, Stat } from "@/ui/primitives";
import { ToneBadge } from "@/ui/tone";
import { useCockpit } from "@/lib/cockpit-store";
import { useWb } from "@/surfaces/workbench/scope";
import { abuseMonitor, arrest, breakageForecast, grandfathering, personas, planVariants, poolStatus, STRATEGIES, upsellCandidates, type RetryStrategy } from "@/growth/analytics";
import { createExperiment, fundFromPool, rescue, saveRewardRule, setBreakagePolicy, setGrandfathering, setLevers, setRuleStatus } from "@/growth/lab-actions";
import { gid } from "@/growth/state";
import { METRIC_BASE } from "@/growth/ideas";
import { GUARDRAILS } from "@/growth/lab";
import { segmentById } from "@/growth/population";
import { primaryMeter } from "@/core/pack";
import { fmtNum, fmtPct, fmtUsd } from "@/core/format";
import { cn } from "@/lib/utils";

const actorOf = (p: string) => `merchant:${p}`;

// ------------------------------------------------------------------ churn arrest

export function ArrestPanel() {
  const { t, run, persona } = useWb();
  const l = t.growth.levers;
  const a = useMemo(() => arrest(t, l, t.growth.rescued), [t, l]);
  const [sheet, setSheet] = useState(false);
  const top = a.queue.slice(0, 6);
  const lever = (patch: Partial<typeof l>, text: string) => run((s) => setLevers(s, patch, actorOf(persona)), text);
  return (
    <section aria-labelledby="arrest-h" className="space-y-4">
      <SectionTitle id="arrest-h" aside="Failed renewal payments this cycle, scaled from the simulated sample">
        Involuntary churn arrest
      </SectionTitle>
      <div className="grid grid-cols-2 gap-4 rounded-xl border border-border bg-card p-4 md:grid-cols-5">
        <Stat label="Failed payments" value={fmtNum(a.failed)} sub={`${fmtNum(a.soft)} soft · ${fmtNum(a.hard)} hard`} />
        <Stat label="Recovered" value={fmtNum(a.recovered)} sub={`${fmtPct(a.recoveryRate)} expected`} />
        <Stat label="Still retrying" value={fmtNum(a.pending)} />
        <Stat label="Lost" value={fmtNum(a.lost)} />
        <Stat label="Revenue at risk" value={fmtUsd(a.atRiskMrr, 0)} sub="MRR" />
      </div>
      <div className="grid gap-6 xl:grid-cols-2">
        <div className="space-y-3 rounded-xl border border-border bg-card p-4">
          <h3 className="type-body font-semibold">Recovery by retry strategy</h3>
          <ul className="space-y-2">
            {a.byStrategy.map((s) => (
              <li key={s.id} className="grid grid-cols-[minmax(0,45%)_1fr_auto] items-center gap-2 type-caption">
                <span>
                  <span className={cn("font-medium", s.id === l.retry && "text-primary")}>{s.label}</span>
                  <span className="block text-muted-foreground">{s.days}</span>
                </span>
                <span aria-hidden="true" className="h-2 overflow-hidden rounded-full bg-muted">
                  <span className={cn("block h-full rounded-full", s.id === l.retry ? "bg-primary" : "bg-info")} style={{ width: `${s.rate * 100}%` }} />
                </span>
                <span className="num font-medium">{fmtPct(s.rate)}</span>
              </li>
            ))}
          </ul>
          <h3 className="pt-2 type-body font-semibold">Pre-dunning and card updates</h3>
          <p className="type-caption">
            {fmtNum(a.pre.expiring)} cards expire before renewal; {fmtNum(a.pre.nudged)} owners nudged, {fmtNum(a.pre.updated)} updated ({fmtPct(a.pre.updated / Math.max(1, a.pre.expiring))}).
          </p>
        </div>
        <div className="space-y-3 rounded-xl border border-border bg-card p-4">
          <h3 className="type-body font-semibold">Levers</h3>
          <div className="flex items-center justify-between gap-2">
            <Label htmlFor="lv-grace" className="type-caption">
              Credits keep working during grace
            </Label>
            <Switch id="lv-grace" checked={l.graceCredits} onCheckedChange={(v) => lever({ graceCredits: v }, v ? "Credits keep working during grace." : "Credits pause when a payment fails.")} />
          </div>
          <div className="flex items-center justify-between gap-2">
            <Label htmlFor="lv-days" className="type-caption">
              Grace window
            </Label>
            <NativeSelect id="lv-days" size="sm" value={String(l.graceDays)} onChange={(e) => lever({ graceDays: Number(e.target.value) }, `Grace window set to ${e.target.value} days.`)}>
              {[3, 5, 7, 10, 14].map((d) => (
                <NativeSelectOption key={d} value={String(d)}>
                  {d} days
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </div>
          <div className="flex items-center justify-between gap-2">
            <Label htmlFor="lv-retry" className="type-caption">
              Retry timing
            </Label>
            <NativeSelect id="lv-retry" size="sm" value={l.retry} onChange={(e) => lever({ retry: e.target.value as RetryStrategy }, `Retry timing: ${STRATEGIES.find((s) => s.id === e.target.value)?.label}.`)}>
              {STRATEGIES.map((s) => (
                <NativeSelectOption key={s.id} value={s.id}>
                  {s.label}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </div>
          <div className="flex items-center justify-between gap-2">
            <Label htmlFor="lv-msg" className="type-caption">
              Message variant
            </Label>
            <NativeSelect id="lv-msg" size="sm" value={l.message} onChange={(e) => lever({ message: e.target.value as typeof l.message }, "Message variant updated.")}>
              <NativeSelectOption value="plain">Plain notice</NativeSelectOption>
              <NativeSelectOption value="loss">What you'll lose</NativeSelectOption>
              <NativeSelectOption value="helpful">Helpful, one tap to fix</NativeSelectOption>
            </NativeSelect>
          </div>
          <div className="flex items-center justify-between gap-2">
            <Label htmlFor="lv-backup" className="type-caption">
              Ask for a backup method
            </Label>
            <Switch id="lv-backup" checked={l.backupPrompt} onCheckedChange={(v) => lever({ backupPrompt: v }, v ? "Backup-method prompts on." : "Backup-method prompts off.")} />
          </div>
        </div>
      </div>
      <div className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="type-body font-semibold">Arrest queue</h3>
          <Button size="sm" onClick={() => setSheet(true)} disabled={!top.length}>
            <Bot aria-hidden="true" />
            Dunning Rescue: draft actions
          </Button>
        </div>
        <Table>
          <TableCaption className="sr-only">Accounts with a failed payment and the recommended action</TableCaption>
          <TableHeader>
            <TableRow>
              <TableHead scope="col">Workspace</TableHead>
              <TableHead scope="col">Decline</TableHead>
              <TableHead scope="col" className="text-right">MRR</TableHead>
              <TableHead scope="col" className="text-right">Grace left</TableHead>
              <TableHead scope="col">Recommended</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {a.queue.slice(0, 10).map((r) => (
              <TableRow key={r.id}>
                <TableHead scope="row" className="font-normal">
                  {r.name}
                  <div className="type-caption text-muted-foreground">{r.plan}</div>
                </TableHead>
                <TableCell>
                  <ToneBadge tone={r.decline === "hard" ? "blocked" : "watch"}>{r.decline}</ToneBadge> <span className="type-caption">{r.reason}</span>
                </TableCell>
                <TableCell className="text-right num">{fmtUsd(r.mrr, 0)}</TableCell>
                <TableCell className="text-right num">{r.graceLeft} days</TableCell>
                <TableCell className="type-caption">{r.action}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {t.growth.rescued.length > 0 && <p className="type-caption text-muted-foreground">{t.growth.rescued.length} accounts already actioned by Dunning Rescue.</p>}
      </div>
      {sheet && (
        <ApprovalSheet
          open
          onOpenChange={setSheet}
          title={`Dunning Rescue: ${top.length} actions`}
          description="The agent drafted one action per account at the top of the queue. Nothing is sent until you approve."
          preview={
            <ul className="space-y-1 type-caption">
              {top.map((r) => (
                <li key={r.id}>
                  <span className="font-medium">{r.name}</span>: {r.action}
                </li>
              ))}
            </ul>
          }
          diff={top.map((r) => ({ path: r.name, before: "queued", after: r.action }))}
          risk={{ level: "low", reasons: ["Customer messages and retries only; no plan or price changes.", "Each action is logged with this approval."] }}
          auditId={`pending · rescue-${top.length}`}
          onApprove={() => {
            run((s) => rescue(s, top.map((r) => r.id), top.map((r) => r.action), actorOf(persona)), `${top.length} rescue actions approved.`);
            setSheet(false);
          }}
          onReject={() => setSheet(false)}
          approveLabel="Approve actions"
        />
      )}
    </section>
  );
}

// ------------------------------------------------------------------ persona plans

export function PersonaPlansPanel() {
  const { t, run, persona, sandbox } = useWb();
  const setUi = useCockpit((s) => s.setUi);
  const ps = useMemo(() => personas(t), [t]);
  const vs = useMemo(() => planVariants(t), [t]);
  const winner = [...vs].sort((a, b) => b.score - a.score)[0];
  const [sandboxed, setSandboxed] = useState(false);
  const gf = useMemo(() => grandfathering(t, winner), [t, winner]);
  const cur = vs.find((v) => v.id === "current")!;
  const owner = persona === "sam" ? "Sam" : "Nia";
  const launch = () => {
    const seg = segmentById(t, "new-signups");
    let id = "";
    run((s) => {
      const r = createExperiment(
        s,
        {
          name: `${winner.label} for new customers`,
          hypothesis: `If new customers see ${winner.label.toLowerCase()}, revenue per signup rises without raising churn. Existing customers: ${gf.find((g) => g.id === s.growth.grandfathering)?.label.toLowerCase()}.`,
          intervention: { type: "packaging", detail: winner.desc, variant: winner.label },
          audience: { id: "new-signups", label: seg?.label ?? "New signups", size: seg?.size ?? 0 },
          allocation: 0.5,
          holdout: 0.1,
          metric: "Paid within 14 days",
          metrics: ["Paid within 14 days", "Margin per credit", "Renewed next cycle"],
          baseRate: METRIC_BASE["Paid within 14 days"],
          mde: 0.15,
          layer: "pricing",
          guardrails: GUARDRAILS.map((g) => ({ ...g })),
          origin: "optimiser",
          sourceId: `variant-${winner.id}`,
          newCustomersOnly: true,
          patches: [],
          prior: [0.02, 0.18],
        },
        owner,
        sandbox,
      );
      id = r.id;
      return r.t;
    }, "Drafted as an experiment for new customers only.");
    setUi({ wbTab: "experiments", wbExperiment: id || null });
  };
  return (
    <section aria-labelledby="persona-h" className="space-y-4">
      <SectionTitle id="persona-h" aside="Behavioural personas from 90 days of usage">
        Persona plans
      </SectionTitle>
      <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {ps.map((p) => (
          <li key={p.id} className="rounded-xl border border-border bg-card p-3">
            <h3 className="type-body font-semibold">{p.label}</h3>
            <p className="type-caption text-muted-foreground">{p.desc}</p>
            <p className="mt-1 type-caption">
              {fmtNum(p.n)} workspaces · {fmtNum(p.paid)} paid · median {fmtNum(p.medianCredits)} credits a month{p.arpu ? ` · ${fmtUsd(p.arpu, 0)} ARPU` : ""}
            </p>
          </li>
        ))}
      </ul>
      <Table>
        <TableCaption className="text-left type-caption">Replaying historical usage against each variant. Revenue and margin come from the replay; conversion and churn are model estimates.</TableCaption>
        <TableHeader>
          <TableRow>
            <TableHead scope="col">Variant</TableHead>
            <TableHead scope="col" className="text-right">Revenue a month</TableHead>
            <TableHead scope="col" className="text-right">Margin</TableHead>
            <TableHead scope="col" className="text-right">Free-to-paid</TableHead>
            <TableHead scope="col" className="text-right">Churn a month</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {vs.map((v) => (
            <TableRow key={v.id} className={cn(v.id === winner.id && "bg-healthy-soft/40")}>
              <TableHead scope="row" className="font-normal">
                <span className="font-medium">{v.label}</span> {v.id === winner.id && <ToneBadge tone="healthy">Best</ToneBadge>}
                <div className="type-caption text-muted-foreground">{v.desc}</div>
              </TableHead>
              <TableCell className="text-right num">
                {fmtUsd(v.revenue, 0)}
                {v.id !== "current" && <div className="type-caption text-muted-foreground">{v.revenue >= cur.revenue ? "+" : "−"}{fmtUsd(Math.abs(v.revenue - cur.revenue), 0)}</div>}
              </TableCell>
              <TableCell className="text-right num">{fmtPct(v.margin)}</TableCell>
              <TableCell className="text-right num">{fmtPct(v.conversion, 1)}</TableCell>
              <TableCell className="text-right num">{fmtPct(v.churn, 1)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <div className="space-y-3 rounded-xl border border-border bg-card p-4">
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="outline" aria-expanded={sandboxed} onClick={() => setSandboxed(true)}>
            Run "{winner.label}" as a sandbox
          </Button>
          <Button size="sm" onClick={launch} disabled={!sandboxed}>
            <FlaskConical aria-hidden="true" />
            Then test it on new customers only
          </Button>
        </div>
        {sandboxed && (
          <div className="space-y-2" role="status">
            <p className="type-body">
              Sandbox: {winner.label} earns {fmtUsd(winner.revenue, 0)} a month against {fmtUsd(cur.revenue, 0)} today. No live plan changed.
            </p>
            <ul className="grid gap-1 sm:grid-cols-4">
              {(Object.keys(winner.byPersona) as (keyof typeof winner.byPersona)[]).map((k) => (
                <li key={k} className="rounded-md bg-muted px-2 py-1 type-caption">
                  {k}: {fmtUsd(winner.byPersona[k], 0)} <span className="text-muted-foreground">({winner.byPersona[k] >= cur.byPersona[k] ? "+" : "−"}{fmtUsd(Math.abs(winner.byPersona[k] - cur.byPersona[k]), 0)})</span>
                </li>
              ))}
            </ul>
          </div>
        )}
        <fieldset className="space-y-2">
          <legend className="type-caption font-semibold">Grandfathering policy for existing customers</legend>
          {gf.map((g) => (
            <label key={g.id} className={cn("flex cursor-pointer gap-3 rounded-lg border p-3", t.growth.grandfathering === g.id ? "border-primary" : "border-border")}>
              <input type="radio" name="gf" className="mt-1 accent-[var(--primary)]" checked={t.growth.grandfathering === g.id} onChange={() => run((s) => setGrandfathering(s, g.id), `Grandfathering: ${g.label}.`)} />
              <span className="type-caption">
                <span className="block font-medium">{g.label}</span>
                <span className="block text-muted-foreground">{g.desc}</span>
                <span className="block">
                  Existing customers: {g.existingNow >= 0 ? "+" : "−"}
                  {fmtUsd(Math.abs(g.existingNow), 0)} a month now, {g.existingYear1 >= 0 ? "+" : "−"}
                  {fmtUsd(Math.abs(g.existingYear1), 0)} in year one, churn {g.churnShift ? `+${fmtPct(g.churnShift, 1)}` : "unchanged"}
                </span>
              </span>
            </label>
          ))}
        </fieldset>
      </div>
    </section>
  );
}

// ------------------------------------------------------------------ breakage pool

export function BreakagePanel() {
  const { t, run, persona } = useWb();
  const b = t.growth.breakage;
  const f = useMemo(() => breakageForecast(t, null), [t]);
  const pool = useMemo(() => poolStatus(t, b), [t, b]);
  const cand = useMemo(() => upsellCandidates(t), [t]);
  const prim = primaryMeter(t.pack);
  const [accounts, setAccounts] = useState(Math.min(500, cand.highIntent));
  const [each, setEach] = useState(100);
  const usd = Math.round(accounts * each * prim.pricePerUnit);
  const fund = (kind: "upsell" | "nudge", label: string, n: number, per: number) => {
    let res = { ok: false, text: "" };
    run((s) => {
      const r = fundFromPool(s, kind, label, n, per, actorOf(persona));
      res = r;
      return r.t;
    }, "", { quiet: true });
    toast[res.ok ? "success" : "error"](res.text);
  };
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4 rounded-xl border border-border bg-card p-4 md:grid-cols-4">
        <Stat label="Forecast breakage next month" value={fmtUsd(f.usd, 0)} sub={`${fmtNum(f.credits)} ${prim.label} · ${fmtPct(f.share)} of paid grants`} />
        <Stat label="Recognised (policy)" value={fmtUsd(pool.recognisedUsd, 0)} sub={`${b.recognisedPct}% of forecast`} />
        <Stat label="Pool may fund" value={fmtUsd(pool.fundingCap, 0)} sub={`${b.fundingPct}% of forecast`} />
        <Stat label="Available" value={fmtUsd(pool.available, 0)} sub={`${fmtUsd(pool.committed, 0)} committed`} />
      </div>
      <section aria-labelledby="brk-h" className="space-y-3">
        <SectionTitle id="brk-h" aside="Unused paid allowance that will expire once each workspace's rollover carry is full">
          Credits expiring unused, by cohort
        </SectionTitle>
        <Table>
          <TableCaption className="sr-only">Forecast breakage by cohort</TableCaption>
          <TableHeader>
            <TableRow>
              <TableHead scope="col">Cohort</TableHead>
              <TableHead scope="col" className="text-right">Workspaces</TableHead>
              <TableHead scope="col" className="text-right">{prim.label}</TableHead>
              <TableHead scope="col" className="text-right">Value</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {f.rows.map((r) => (
              <TableRow key={r.id}>
                <TableHead scope="row" className="font-normal">{r.label}</TableHead>
                <TableCell className="text-right num">{fmtNum(r.accounts)}</TableCell>
                <TableCell className="text-right num">{fmtNum(r.credits)}</TableCell>
                <TableCell className="text-right num">{fmtUsd(r.usd, 0)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </section>
      <div className="grid gap-6 xl:grid-cols-2">
        <section aria-labelledby="fin-h" className="space-y-3 rounded-xl border border-border bg-card p-4">
          <h3 id="fin-h" className="flex items-center gap-2 type-body font-semibold">
            <Landmark aria-hidden="true" className="size-4" />
            Finance policy
          </h3>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="rec-pct" className="type-caption">
                Recognised breakage
              </Label>
              <NativeSelect id="rec-pct" size="sm" value={String(b.recognisedPct)} onChange={(e) => run((s) => setBreakagePolicy(s, Number(e.target.value), s.growth.breakage.fundingPct, actorOf(persona)), "Recognised-breakage policy updated.")}>
                {[50, 60, 70, 80, 90, 100].map((v) => (
                  <NativeSelectOption key={v} value={String(v)}>
                    {v}% of forecast
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </div>
            <div className="space-y-1">
              <Label htmlFor="fund-pct" className="type-caption">
                Funding rule
              </Label>
              <NativeSelect id="fund-pct" size="sm" value={String(b.fundingPct)} onChange={(e) => run((s) => setBreakagePolicy(s, s.growth.breakage.recognisedPct, Number(e.target.value), actorOf(persona)), "Funding rule updated.")}>
                {[0, 10, 15, 20, 25, 30, 40].map((v) => (
                  <NativeSelectOption key={v} value={String(v)}>
                    Up to {v}% of forecast
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </div>
          </div>
          <p className="rounded-lg bg-watch-soft p-3 type-caption text-watch-ink">
            Confirm the accounting treatment with finance before relying on these numbers. Breakage recognition depends on contracts and jurisdiction. The pool funds new promotional credits; it never moves one customer's paid credits to
            another.
          </p>
        </section>
        <section aria-labelledby="ups-h" className="space-y-3 rounded-xl border border-border bg-card p-4">
          <h3 id="ups-h" className="flex items-center gap-2 type-body font-semibold">
            <Coins aria-hidden="true" className="size-4" />
            Fund upsell credits
          </h3>
          <p className="type-caption text-muted-foreground">
            {fmtNum(cand.total)} free workspaces at the limit; {fmtNum(cand.highIntent)} show high intent (blocked three or more times, two or more tables). Promotional credits expire in {t.pack.growth.breakage.promoExpiryDays} days.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="ups-n" className="type-caption">
                Accounts
              </Label>
              <Input id="ups-n" type="number" min={1} max={cand.total} value={accounts} onChange={(e) => setAccounts(Math.max(0, Math.round(Number(e.target.value) || 0)))} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="ups-each" className="type-caption">
                {prim.label} each
              </Label>
              <Input id="ups-each" type="number" min={1} value={each} onChange={(e) => setEach(Math.max(0, Math.round(Number(e.target.value) || 0)))} />
            </div>
          </div>
          <p className={cn("type-caption", usd > pool.available ? "font-medium text-blocked-ink" : "")}>
            {fmtNum(accounts * each)} {prim.label} at list price: {fmtUsd(usd, 0)} against {fmtUsd(pool.available, 0)} available.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" disabled={!accounts || !each} onClick={() => fund("upsell", "Upsell credits for high-intent free users", accounts, each)}>
              <Plus aria-hidden="true" />
              Fund from the pool
            </Button>
            <Button size="sm" variant="outline" onClick={() => fund("nudge", "Use-or-extend nudge for owners of expiring credits", f.rows.reduce((s, r) => s + r.accounts, 0), 0)}>
              <Megaphone aria-hidden="true" />
              Nudge owners of expiring credits
            </Button>
          </div>
        </section>
      </div>
      {b.commits.length > 0 && (
        <section aria-labelledby="com-h" className="space-y-2">
          <SectionTitle id="com-h">Commitments this month</SectionTitle>
          <ul className="space-y-1">
            {b.commits.map((c) => (
              <li key={c.id} className="type-caption">
                <ToneBadge tone={c.kind === "nudge" ? "info" : "reward"}>{c.kind}</ToneBadge> {c.label}: {fmtNum(c.accounts)} accounts{c.usd ? ` · ${fmtNum(c.credits)} credits · ${fmtUsd(c.usd, 0)} · expires in ${c.expiresDays} days` : ""}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ rewards studio

export function RewardsStudioPanel() {
  const { t, run, persona, sandbox } = useWb();
  const setUi = useCockpit((s) => s.setUi);
  const prim = primaryMeter(t.pack);
  const ab = useMemo(() => abuseMonitor(t), [t]);
  const blank = (): RewardRule => ({ id: gid("rr", t.clock), label: "", action: "", amount: 10, meter: prim.id, capPerMonth: 30, expiryDays: 14, eligibility: "Activated free users", funding: "breakage", status: "draft", createdAt: t.clock });
  const [form, setForm] = useState<RewardRule>(blank);
  const owner = persona === "sam" ? "Sam" : "Nia";
  const save = () => {
    let res = { ok: false, text: "" };
    run((s) => {
      const r = saveRewardRule(s, { ...form, label: form.label || form.action }, actorOf(persona));
      res = r;
      return r.t;
    }, "", { quiet: true });
    toast[res.ok ? "success" : "error"](res.text);
    if (res.ok) setForm(blank());
  };
  const abTest = (r: RewardRule) => {
    const seg = segmentById(t, "free-activated");
    let id = "";
    run((s) => {
      const c = createExperiment(
        s,
        {
          name: `Reward: ${r.label}`,
          hypothesis: `If ${r.eligibility.toLowerCase()} earn ${r.amount} ${prim.label} for "${r.action.toLowerCase()}", more run a second table within 7 days.`,
          intervention: { type: "reward-rule", detail: `${r.amount} ${prim.label} for "${r.action}", cap ${r.capPerMonth} a month, ${r.expiryDays}-day expiry, funded from ${r.funding}`, variant: r.label },
          audience: { id: "free-activated", label: seg?.label ?? "Activated free users", size: seg?.size ?? 0 },
          allocation: 0.6,
          holdout: 0.05,
          metric: "Ran a second table within 7 days",
          metrics: ["Ran a second table within 7 days", "Paid within 14 days"],
          baseRate: METRIC_BASE["Ran a second table within 7 days"],
          mde: 0.1,
          layer: "lifecycle",
          guardrails: GUARDRAILS.map((g) => ({ ...g })),
          origin: "rewards",
          sourceId: `reward-${r.id}`,
          newCustomersOnly: false,
          patches: [{ path: `rewards.${t.pack.rewards.length}`, before: undefined, after: { id: r.id.replace(/^rr_?/, "r-").slice(0, 30), label: r.label, amount: r.amount, meter: r.meter, expiryDays: r.expiryDays }, label: `Reward rule: ${r.label}` }],
          prior: [0.04, 0.14],
        },
        owner,
        sandbox,
      );
      id = c.id;
      return setRuleStatus(c.t, r.id, "testing");
    }, `"${r.label}" drafted as an A/B test.`);
    setUi({ wbTab: "experiments", wbExperiment: id || null });
  };
  return (
    <div className="space-y-6">
      <section aria-labelledby="rules-h" className="space-y-3">
        <SectionTitle id="rules-h" aside="Good behaviour is always rewarded; low-value behaviour never is">
          Reward rules
        </SectionTitle>
        <Table>
          <TableCaption className="sr-only">Reward rules with amount, cap, expiry, eligibility, funding and status</TableCaption>
          <TableHeader>
            <TableRow>
              <TableHead scope="col">Rule</TableHead>
              <TableHead scope="col" className="text-right">Amount</TableHead>
              <TableHead scope="col" className="text-right">Cap / month</TableHead>
              <TableHead scope="col">Expiry · eligibility · funding</TableHead>
              <TableHead scope="col">Status</TableHead>
              <TableHead scope="col"><span className="sr-only">Actions</span></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {t.growth.rewardRules.map((r) => (
              <TableRow key={r.id}>
                <TableHead scope="row" className="font-normal">
                  <span className="font-medium">{r.label}</span>
                  <div className="type-caption text-muted-foreground">{r.action}</div>
                </TableHead>
                <TableCell className="text-right num">{fmtNum(r.amount)}</TableCell>
                <TableCell className="text-right num">{fmtNum(r.capPerMonth)}</TableCell>
                <TableCell className="type-caption">
                  {r.expiryDays} days · {r.eligibility} · {r.funding === "breakage" ? "breakage pool" : r.funding}
                </TableCell>
                <TableCell>
                  <ToneBadge tone={r.status === "live" ? "healthy" : r.status === "testing" ? "info" : "neutral"}>{r.status}</ToneBadge>
                </TableCell>
                <TableCell>
                  {r.status === "draft" && (
                    <Button size="xs" variant="outline" onClick={() => abTest(r)}>
                      A/B test it
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <form
          className="grid gap-3 rounded-xl border border-dashed border-border p-3 md:grid-cols-3"
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
        >
          <div className="space-y-1 md:col-span-2">
            <Label htmlFor="rr-action">Qualifying action</Label>
            <Input id="rr-action" value={form.action} onChange={(e) => setForm({ ...form, action: e.target.value })} placeholder="Publish a table template others reuse" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="rr-label">Name</Label>
            <Input id="rr-label" value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} placeholder="Template author" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="rr-amount">{prim.label} each time</Label>
            <Input id="rr-amount" type="number" min={1} value={form.amount} onChange={(e) => setForm({ ...form, amount: Number(e.target.value) })} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="rr-cap">Cap a month</Label>
            <Input id="rr-cap" type="number" min={1} value={form.capPerMonth} onChange={(e) => setForm({ ...form, capPerMonth: Number(e.target.value) })} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="rr-exp">Expires after (days)</Label>
            <Input id="rr-exp" type="number" min={1} value={form.expiryDays} onChange={(e) => setForm({ ...form, expiryDays: Number(e.target.value) })} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="rr-elig">Eligibility</Label>
            <NativeSelect id="rr-elig" value={form.eligibility} onChange={(e) => setForm({ ...form, eligibility: e.target.value })}>
              {["Activated free users", "Paid workspaces", "Any workspace with a verified domain"].map((x) => (
                <NativeSelectOption key={x} value={x}>
                  {x}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </div>
          <div className="space-y-1">
            <Label htmlFor="rr-fund">Funding source</Label>
            <NativeSelect id="rr-fund" value={form.funding} onChange={(e) => setForm({ ...form, funding: e.target.value as RewardRule["funding"] })}>
              <NativeSelectOption value="breakage">Breakage pool</NativeSelectOption>
              <NativeSelectOption value="marketing">Marketing budget</NativeSelectOption>
              <NativeSelectOption value="plan">Plan allowance</NativeSelectOption>
            </NativeSelect>
          </div>
          <div className="flex items-end">
            <Button type="submit" disabled={!form.action.trim()}>
              <Plus aria-hidden="true" />
              Save as draft
            </Button>
          </div>
        </form>
      </section>
      <section aria-labelledby="abuse-h" className="space-y-3">
        <SectionTitle id="abuse-h" aside={`${fmtNum(ab.walletsChecked)} free wallets checked · ${fmtNum(ab.refused)} grants refused by the one-wallet-per-domain rule`}>
          <span className="inline-flex items-center gap-2">
            <ShieldAlert aria-hidden="true" className="size-4" />
            Abuse monitor
          </span>
        </SectionTitle>
        <Table>
          <TableCaption className="sr-only">Domains with many reward wallets or signup bursts</TableCaption>
          <TableHeader>
            <TableRow>
              <TableHead scope="col">Domain</TableHead>
              <TableHead scope="col" className="text-right">Wallets</TableHead>
              <TableHead scope="col" className="text-right">Signup days</TableHead>
              <TableHead scope="col">Flag</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {ab.rows.map((r) => (
              <TableRow key={r.domain}>
                <TableHead scope="row" className="font-mono font-normal">{r.domain}</TableHead>
                <TableCell className="text-right num">{fmtNum(r.wallets)}</TableCell>
                <TableCell className="text-right num">{r.days}</TableCell>
                <TableCell>
                  <ToneBadge tone={r.flag === "watch" ? "neutral" : "blocked"}>{r.flag}</ToneBadge>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </section>
    </div>
  );
}
