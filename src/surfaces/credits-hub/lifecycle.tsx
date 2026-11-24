// Free-user lifecycle lens (Phase 2 §2.12): the eight stages from signed up to converted,
// where Maya is now, what each stage's moment looks like, and its guardrail.
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { MomentCard } from "@/ui/moment-card";
import { SectionTitle } from "@/ui/primitives";
import { ToneBadge } from "@/ui/tone";
import { useMoney } from "@/ui/money";
import { useHub } from "@/surfaces/credits-hub/hub-context";
import { cycleOf, fmtDate, lifecycleOf, lotsOf, planOf, primaryMeter, recordNudge, setOptOut, sparkStatus, stageDefs, type StageId } from "@/core";

export function LifecycleTab() {
  const { t, account, viewer, run, act, goTab } = useHub();
  const { amountText, fmtUsd } = useMoney();
  const pack = t.pack;
  const hub = t.hub[account];
  const v = lifecycleOf(t, account);
  const defs = stageDefs(t);
  const [open, setOpen] = useState<StageId | null>(v.current);
  const prim = primaryMeter(pack);
  const { end } = cycleOf(t);
  const spark = sparkStatus(t, account);
  const expiring = lotsOf(t.ledger, account, prim.id).filter((l) => l.expiresAt && new Date(l.expiresAt).getTime() - new Date(t.clock).getTime() < 14 * 86_400_000);
  const expAmt = expiring.reduce((s, l) => s + l.remaining, 0);
  const trial = pack.hub.paidTrial;
  const sp = pack.hub.starterPack;

  const preview = (id: StageId) => {
    switch (id) {
      case "signed-up":
        return <MomentCard tone="info" trigger="Lifecycle · signed up" headline="Your first table is ready" evidence={`${pack.hub.templateTable}. Add one column and see results in under five minutes. No tour to sit through; help is one click away if you want it.`} primary={{ label: "Open Tables", onClick: () => goTab("tables") }} />;
      case "activated":
        return <MomentCard tone="reward" trigger="Lifecycle · activated" headline={`First verified results: +${amountText(prim, pack.hub.activation.amount)}, once`} evidence={`Your first run with ${pack.hub.activation.minRows}+ verified ${pack.workUnit.many} earns a one-time reward. One per verified domain, so it can't be farmed with new accounts.`} primary={{ label: "See rewards", onClick: () => goTab("rewards") }} />;
      case "habit":
        return <MomentCard tone="reward" trigger="Lifecycle · habit" headline={`${spark.label} streak unlocked`} evidence={`Three active days in seven unlock the daily reward: ${amountText(prim, spark.amount)} on each day with a qualifying run, up to ${amountText(prim, spark.monthlyCap)} a cycle.`} primary={{ label: "See streak", onClick: () => goTab("rewards") }} />;
      case "near-limit":
        return <MomentCard tone="watch" trigger="Lifecycle · 80% used" headline="You've used most of this cycle's credits" evidence={`Before the next run, the estimator shows what it will cost and how many rows your balance covers. No countdowns, no "last chance": credits reset ${fmtDate(end)}.`} primary={{ label: "Estimate a run", onClick: () => goTab("tables") }} />;
      case "limit-hit":
        return (
          <MomentCard
            tone="atRisk"
            trigger="Lifecycle · limit hit"
            headline="Run paused mid-way, nothing lost"
            evidence={`Options at the limit: ${sp ? `a starter pack (${amountText(prim, sp.units)} for ${fmtUsd(sp.price)}), ` : ""}${trial ? `a ${trial.days}-day paid trial of ${planOf(pack, trial.planId).name}, ` : ""}own key, waiting for the reset or running fewer rows. Which offer leads is set by ${pack.company}'s experiments.`}
            primary={{ label: "See the paused run", onClick: () => goTab("tables") }}
          />
        );
      case "never-activated": {
        const capped = v.nudgesUsed >= v.nudgesMax;
        return (
          <MomentCard
            tone="info"
            trigger="Lifecycle · not started yet"
            headline="Want a hand with the first table?"
            evidence={`An agent builds the first table with you, narrating each step. On day ${pack.hub.nudges.humanHelpDay} a person offers a 15-minute call. At most ${v.nudgesMax} nudges, ever: ${v.nudgesUsed} sent${v.optOut ? "; you've opted out, so none will go" : ""}.`}
            primary={{
              label: capped ? "Nudge limit reached" : v.optOut ? "Opted out" : "Send the guided-table nudge",
              disabled: capped || v.optOut,
              onClick: () => act((s) => recordNudge(s, account, "activation.guided-table"), (r) => ({ ok: r === "sent", text: r === "sent" ? "Nudge sent." : r === "capped" ? `Not sent: the ${v.nudgesMax}-nudge limit is reached.` : "Not sent: product e-mails are off for this account." })),
            }}
          />
        );
      }
      case "quiet":
        return (
          <MomentCard
            tone="watch"
            trigger={`Lifecycle · ${pack.hub.nudges.quietDays} days quiet`}
            headline={expAmt > 0 ? `${amountText(prim, expAmt)} expire on ${fmtDate(expiring[0].expiresAt!)}` : "Your credits are waiting"}
            evidence={`A win-back shows what will expire and what it would buy, nothing more. ${v.optOut ? "This account opted out, so the e-mail isn't sent; it only shows here." : "Product e-mails can be turned off below and stay off."}`}
            primary={{ label: "Open Tables", onClick: () => goTab("tables") }}
          />
        );
      case "converted":
        return <MomentCard tone="healthy" trigger="Lifecycle · first payment" headline="Welcome to paid: three things worth setting" evidence="Set spend limits so nobody gets a surprise, invite teammates with the right role, and decide how auto top-up should behave at your cap." primary={{ label: "Set limits", onClick: () => goTab("limits") }} />;
    }
  };

  return (
    <div className="space-y-6">
      <section aria-labelledby="lc-h" className="space-y-3">
        <SectionTitle id="lc-h" aside={<ToneBadge tone="info">Now: {defs.find((d) => d.id === v.current)?.label}</ToneBadge>}>
          {viewer.name}'s lifecycle
        </SectionTitle>
        <dl className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Fact k="Signed up" v={`${v.daysSinceSignup} days ago`} />
          <Fact k="Active days, last 7" v={String(v.activeDays7)} />
          <Fact k="Most-used meter" v={v.pctUsed.length ? `${Math.round(Math.max(...v.pctUsed.map((x) => x.pct)) * 100)}%` : "0%"} />
          <Fact k="Activation nudges" v={`${v.nudgesUsed} of ${v.nudgesMax}`} />
        </dl>
        <div className="flex items-center gap-2">
          <Switch id="lc-optout" checked={!v.optOut} disabled={!viewer.can("plan") && viewer.id !== account} onCheckedChange={(on) => run((s) => setOptOut(s, account, !on, viewer.actor).state, on ? "Product e-mails on." : "Product e-mails off. Win-backs and nudges won't be sent.")} />
          <Label htmlFor="lc-optout">Product e-mails (nudges and win-backs)</Label>
        </div>
      </section>
      <ol className="space-y-2" aria-label="Lifecycle stages">
        {defs.map((d, i) => {
          const f = v.facts[d.id];
          const tone = f.state === "current" ? "info" : f.state === "reached" ? "healthy" : "neutral";
          return (
            <li key={d.id} className={`rounded-xl border bg-card ${f.state === "current" ? "border-primary" : "border-border"}`}>
              <div className="grid gap-2 p-4 md:grid-cols-[minmax(0,1.1fr)_minmax(0,1.3fr)_minmax(0,1fr)_auto] md:items-start">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="type-caption num text-muted-foreground">{i + 1}</span>
                    <span className="type-body font-semibold">{d.label}</span>
                    <ToneBadge tone={tone}>{f.state === "current" ? "Now" : f.state === "reached" ? "Reached" : f.state === "skipped" ? "Skipped" : "Not yet"}</ToneBadge>
                  </div>
                  <p className="type-caption text-muted-foreground">
                    {d.trigger} · {f.detail}
                  </p>
                </div>
                <p className="type-body">{d.moment}</p>
                <p className="type-caption">
                  <span className="text-muted-foreground">Guardrail: </span>
                  {d.guardrail}
                </p>
                <Button size="sm" variant="ghost" aria-expanded={open === d.id} onClick={() => setOpen(open === d.id ? null : d.id)}>
                  {open === d.id ? "Hide moment" : "See the moment"}
                </Button>
              </div>
              {open === d.id && <div className="border-t border-border p-4">{preview(d.id)}</div>}
            </li>
          );
        })}
      </ol>
      <p className="type-caption text-muted-foreground">Account {hub.profile.email.split("@")[1]} · rewards are one per verified domain · every nudge and reward is in the event log.</p>
    </div>
  );
}

function Fact({ k, v }: { k: string; v: string }) {
  return (
    <div className="rounded-xl border border-border bg-card p-3">
      <dt className="type-caption text-muted-foreground">{k}</dt>
      <dd className="type-heading num">{v}</dd>
    </div>
  );
}
