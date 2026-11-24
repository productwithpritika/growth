// Home: balance and pulse (Phase 2 §2.1). Two meters side by side, a plain-language line on
// what the balance buys, Today's Spark, the moment feed by urgency and a plan-fit teaser.
// Maya sees a conversion-aware panel; Dev sees team spend; a Member sees their own limit.
import { useMemo, useState } from "react";
import { Flame, Sparkles, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { BalanceCard } from "@/ui/balance-card";
import { SectionTitle, UsageBar } from "@/ui/primitives";
import { ToneBadge } from "@/ui/tone";
import { useMoney } from "@/ui/money";
import { useFeature } from "@/ui/horizon";
import { useHub } from "@/surfaces/credits-hub/hub-context";
import { MomentFeed } from "@/surfaces/credits-hub/moments";
import { RequestCreditsDialog } from "@/surfaces/credits-hub/request-credits";
import { breakdown, cycleOf, fmtDate, limitsFor, meterOf, meterTimeline, planFit, planOf, primaryMeter, runHistory, sparkStatus, usualMix, type RunRecord } from "@/core";

export function HomeTab() {
  const { t, account, viewer } = useHub();
  const showMoments = useFeature("hub.moments");
  const showForecast = useFeature("hub.forecast");
  const pack = t.pack;
  const runs = useMemo(() => runHistory(t, account, 30), [t, account]);
  const prim = primaryMeter(pack);
  const tl = meterTimeline(t, account, prim.id);
  const mix = usualMix(pack, runs, prim.id, tl.balance);
  const { amountText } = useMoney();

  return (
    <div className="space-y-6">
      {showMoments && <MomentFeed />}
      <div className="space-y-2">
        <div className={pack.meters.length > 1 ? "grid gap-4 lg:grid-cols-2" : "grid gap-4"}>
          {pack.meters.map((m) => (
            <BalanceCard key={m.id} t={t} personaId={account} meter={m} compact={!showForecast} />
          ))}
        </div>
        <p className="type-body text-muted-foreground" data-testid="usual-mix">
          {tl.balance > 0
            ? `You have ${amountText(prim, tl.balance)}${mix ? `, enough for about ${mix.n.toLocaleString("en-US")} ${mix.noun} at your usual mix` : ""}.`
            : `You have no ${prim.label} left this cycle. ${tl.held > 0 ? `${amountText(prim, tl.held)} are held for a run in progress.` : ""}`}
        </p>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <SparkTile />
        <PlanFitTeaser />
      </div>
      {viewer.isMemberPersona || viewer.role === "member" ? <MemberPanel runs={runs} /> : account === "dev" ? <TeamSpend runs={runs} /> : <ConversionPanel />}
    </div>
  );
}

function SparkTile() {
  const { t, account, goTab } = useHub();
  const { amountText } = useMoney();
  const s = sparkStatus(t, account);
  const m = meterOf(t.pack, s.meter);
  if (!s.enabled)
    return (
      <section aria-labelledby="spark-title" className="rounded-xl border border-border bg-card p-4">
        <SectionTitle id="spark-title" as="h3">
          Daily rewards
        </SectionTitle>
        <p className="type-body text-muted-foreground">{t.pack.company} doesn't run a daily reward. Badges and one-off rewards are in Rewards.</p>
      </section>
    );
  return (
    <section aria-labelledby="spark-title" className="space-y-3 rounded-xl border border-border bg-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <SectionTitle id="spark-title" as="h3">
            Today's {s.label}
          </SectionTitle>
          <p className="type-body text-muted-foreground">
            {s.grantedToday
              ? `Earned today: +${amountText(m, s.amount)}, spent first and valid ${s.expiryDays} days.`
              : s.capLeft <= 0
                ? `You've earned this cycle's ${amountText(m, s.monthlyCap)} cap. It starts again on ${fmtDate(cycleOf(t).end)}.`
                : `+${amountText(m, s.amount)} when you run an enrichment on ${s.minRows}+ ${t.pack.workUnit.many} that returns verified results today.`}
          </p>
        </div>
        <ToneBadge tone={s.grantedToday ? "reward" : "neutral"}>{s.grantedToday ? "Earned" : "Not yet today"}</ToneBadge>
      </div>
      <ol aria-label="Qualifying days, last 14" className="flex gap-1">
        {s.last14.map((d) => (
          <li key={d.day} title={`${fmtDate(d.day)}: ${d.granted ? "earned" : d.qualified ? "qualified" : "no qualifying run"}`} className={`h-6 flex-1 rounded-sm ${d.granted ? "bg-reward-ink/70" : d.qualified ? "bg-reward-soft" : "bg-muted"}`}>
            <span className="sr-only">
              {fmtDate(d.day)}: {d.granted ? "earned" : d.qualified ? "qualified" : "none"}
            </span>
          </li>
        ))}
      </ol>
      <div className="flex flex-wrap items-center justify-between gap-2 type-caption text-muted-foreground">
        <span className="inline-flex items-center gap-1">
          <Flame aria-hidden="true" className="size-3.5" />
          {s.streak ? `${s.streak}-day streak` : "No streak yet"} · {amountText(m, s.earnedThisCycle, { label: false })} of {amountText(m, s.monthlyCap)} this cycle
        </span>
        {!s.grantedToday && s.capLeft > 0 && (
          <Button size="sm" variant="outline" onClick={() => goTab("tables")}>
            Run a table
          </Button>
        )}
      </div>
      {s.refusedRule && <p className="type-caption text-watch-ink">Not granted today: {s.refusedRule}.</p>}
    </section>
  );
}

function PlanFitTeaser() {
  const { t, account, viewer, goTab } = useHub();
  const { fmtUsd } = useMoney();
  const fit = useMemo(() => planFit(t, account), [t, account]);
  const cur = fit.current;
  const best = fit.cheapest;
  const plan = planOf(t.pack, t.hub[account].planId);
  const saves = cur && best ? cur.total - best.total : 0;
  return (
    <section aria-labelledby="fit-title" className="space-y-3 rounded-xl border border-border bg-card p-4">
      <SectionTitle id="fit-title" as="h3">
        Plan fit, last 90 days
      </SectionTitle>
      {!best ? (
        <p className="type-body text-muted-foreground">Not enough usage yet to compare plans. Plan fit appears after your first runs.</p>
      ) : (
        <p className="type-body">
          {best.cfg.planId === plan.id && !Object.values(best.cfg.addOns).some(Boolean)
            ? `${plan.name} is already your cheapest fit: ${fmtUsd(best.total, 0)} over 90 days including top-ups.`
            : saves > 1
              ? `${best.label} would have cost ${fmtUsd(best.total, 0)} over the last 90 days, ${fmtUsd(saves, 0)} less than you paid.`
              : `${best.label} fits your last 90 days for ${fmtUsd(best.total, 0)}.`}{" "}
          {fit.noRunOut && fit.noRunOut.label !== best.label ? `${fit.noRunOut.label} would never have run out (${fmtUsd(fit.noRunOut.total, 0)}).` : ""}
        </p>
      )}
      {viewer.can("plan") && (
        <Button size="sm" variant="outline" onClick={() => goTab("plan")}>
          Compare plans
        </Button>
      )}
    </section>
  );
}

function TeamSpend({ runs }: { runs: RunRecord[] }) {
  const { t, account, goTab } = useHub();
  const { amountText, fmtUsd } = useMoney();
  const pack = t.pack;
  const hub = t.hub[account];
  const prim = primaryMeter(pack);
  const { start } = cycleOf(t);
  const cycleRuns = runs.filter((r) => new Date(r.ts) >= start);
  const members = breakdown(pack, hub, cycleRuns, "member");
  const tables = breakdown(pack, hub, cycleRuns, "table").slice(0, 3);
  const max = Math.max(1, ...members.map((m) => m.meters[prim.id] ?? 0));
  const pending = hub.requests.filter((r) => r.status === "pending").length;
  return (
    <section aria-labelledby="team-title" className="space-y-3 rounded-xl border border-border bg-card p-4">
      <SectionTitle id="team-title" as="h3" aside={<span className="inline-flex items-center gap-1 type-caption text-muted-foreground"><Users aria-hidden="true" className="size-3.5" />{hub.team.length} people</span>}>
        Team spend this cycle
      </SectionTitle>
      {members.length === 0 ? (
        <p className="type-body text-muted-foreground">No runs yet this cycle.</p>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <ul className="space-y-2" aria-label="Who burned what">
            {members.map((m) => {
              const lim = limitsFor(hub, t.events, account, start, { member: m.key, tableId: "", table: "" }).find((l) => l.limit.scope === "member");
              return (
                <li key={m.key} className="space-y-1">
                  <div className="flex items-baseline justify-between gap-2 type-body">
                    <span className="font-medium">{m.label}</span>
                    <span className="num text-muted-foreground">
                      {amountText(prim, m.meters[prim.id] ?? 0)} · {fmtUsd(m.usd)}
                    </span>
                  </div>
                  <UsageBar value={m.meters[prim.id] ?? 0} max={lim ? lim.limit.amount : max} label={`${m.label}: ${amountText(prim, m.meters[prim.id] ?? 0)}${lim ? ` of a ${amountText(prim, lim.limit.amount)} limit` : ""}`} />
                  {lim && <p className="type-caption text-muted-foreground">{Math.round(lim.pct * 100)}% of a {amountText(prim, lim.limit.amount)} {lim.limit.behaviour === "block" ? "blocking" : "warning"} limit</p>}
                </li>
              );
            })}
          </ul>
          <div className="space-y-2">
            <h4 className="type-caption font-medium text-muted-foreground">Biggest tables</h4>
            <ul className="space-y-1.5">
              {tables.map((x) => (
                <li key={x.key} className="flex items-baseline justify-between gap-2 type-body">
                  <span className="min-w-0 truncate">{x.label}</span>
                  <span className="num shrink-0 text-muted-foreground">{amountText(prim, x.meters[prim.id] ?? 0)}</span>
                </li>
              ))}
            </ul>
            <div className="flex flex-wrap gap-2 pt-1">
              <Button size="sm" variant="outline" onClick={() => goTab("usage")}>
                Explain usage
              </Button>
              <Button size="sm" variant="outline" onClick={() => goTab("limits")}>
                {pending ? `${pending} request${pending === 1 ? "" : "s"} waiting` : "Limits and roles"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

function MemberPanel({ runs }: { runs: RunRecord[] }) {
  const { t, account, viewer } = useHub();
  const { amountText } = useMoney();
  const [open, setOpen] = useState(false);
  const pack = t.pack;
  const hub = t.hub[account];
  const prim = primaryMeter(pack);
  const { start } = cycleOf(t);
  const mine = runs.filter((r) => r.member === viewer.id && new Date(r.ts) >= start);
  const used = mine.reduce((s, r) => s + (r.meters[prim.id] ?? 0), 0);
  const lim = limitsFor(hub, t.events, account, start, { member: viewer.id, tableId: "", table: "" }).find((l) => l.limit.scope === "member");
  const ws = meterTimeline(t, account, prim.id);
  return (
    <section aria-labelledby="mine-title" className="space-y-3 rounded-xl border border-border bg-card p-4">
      <SectionTitle id="mine-title" as="h3">
        Your usage this cycle
      </SectionTitle>
      <p className="type-body">
        {amountText(prim, used)} across {mine.length} run{mine.length === 1 ? "" : "s"}
        {lim ? `, ${Math.round(lim.pct * 100)}% of your ${amountText(prim, lim.limit.amount)} limit (${lim.limit.behaviour === "block" ? "runs pause at the limit" : "warning only"}).` : ". No personal limit is set."}
      </p>
      {lim && <UsageBar value={lim.spent} max={lim.limit.amount} label={`Your limit: ${amountText(prim, lim.spent)} of ${amountText(prim, lim.limit.amount)}`} />}
      <p className="type-caption text-muted-foreground">
        The workspace has {amountText(prim, ws.balance)} left. You can run tables; buying credits and changing the plan sit with {hub.team.filter((m) => m.role !== "member").map((m) => m.name).join(" and ")}.
      </p>
      <Button size="sm" onClick={() => setOpen(true)}>
        Request credits
      </Button>
      {open && <RequestCreditsDialog open onOpenChange={setOpen} prefill={{ meter: prim.id, amount: lim ? Math.max(50, Math.round(lim.limit.amount * 0.3)) : 100, reason: `More ${prim.label} to finish this week's tables.` }} />}
    </section>
  );
}

/** Maya on Free: what paying would change, from her own 90 days, without pressure. */
function ConversionPanel() {
  const { t, account, goTab } = useHub();
  const { fmtUsd, amountText } = useMoney();
  const fit = useMemo(() => planFit(t, account), [t, account]);
  const pack = t.pack;
  const plan = planOf(pack, t.hub[account].planId);
  const prim = primaryMeter(pack);
  const peak = Math.max(0, ...fit.windows.map((w) => w.demand[prim.id] ?? 0));
  const target = fit.noRunOut;
  const sp = pack.hub.starterPack;
  if (plan.paid)
    return (
      <section aria-labelledby="conv-title" className="rounded-xl border border-border bg-card p-4">
        <SectionTitle id="conv-title" as="h3">
          Your plan
        </SectionTitle>
        <p className="type-body text-muted-foreground">You're on {plan.name}. Plan fit above shows whether another size would have cost less.</p>
      </section>
    );
  return (
    <section aria-labelledby="conv-title" className="space-y-3 rounded-xl border border-border bg-card p-4">
      <SectionTitle id="conv-title" as="h3" aside={<Sparkles aria-hidden="true" className="size-4 text-muted-foreground" />}>
        What paying would change for you
      </SectionTitle>
      <p className="type-body">
        Your busiest 30 days needed about {amountText(prim, peak)}; {plan.name} includes {amountText(prim, plan.included[prim.id] ?? 0)}.
        {target ? ` ${target.label} (${fmtUsd(target.monthly, 0)} a month) would have covered every run in the last 90 days without pausing.` : ""}
      </p>
      <ul className="grid gap-2 sm:grid-cols-3">
        <li className="rounded-lg border border-border p-3">
          <div className="type-body font-medium">Stay on {plan.name}</div>
          <div className="type-caption text-muted-foreground">Credits reset {fmtDate(cycleOf(t).end)}. Own API keys cost no {prim.label}.</div>
        </li>
        {sp && (
          <li className="rounded-lg border border-border p-3">
            <div className="type-body font-medium">Starter pack</div>
            <div className="type-caption text-muted-foreground">
              {amountText(prim, sp.units)} for {fmtUsd(sp.price)} once ({fmtUsd(sp.price / sp.units, 3)} each)
            </div>
          </li>
        )}
        {target && (
          <li className="rounded-lg border border-border p-3">
            <div className="type-body font-medium">{target.label}</div>
            <div className="type-caption text-muted-foreground">{fmtUsd(target.monthly, 0)} a month, prorated today{pack.hub.paidTrial ? ` · ${pack.hub.paidTrial.days}-day paid trial available` : ""}</div>
          </li>
        )}
      </ul>
      <p className="type-caption text-muted-foreground">Which offer you see at the limit is decided by {pack.company}'s pricing experiments, not by how often you log in.</p>
      <Button size="sm" variant="outline" onClick={() => goTab("lifecycle")}>
        Open the lifecycle view
      </Button>
    </section>
  );
}
