// The Home moment feed (Phase 2 §2.1, §2.4): every low, out, paused, failed or waiting state
// as a MomentCard with a reason, evidence and one primary action, ordered by urgency.
import { useMemo, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { MomentCard } from "@/ui/moment-card";
import type { HubTab } from "@/lib/cockpit-store";
import { capWindow, evaluateMoment, latestDef, liveDef } from "@/platform/moments";
import { useMoney } from "@/ui/money";
import { usePay } from "@/surfaces/credits-hub/payments";
import { useHub } from "@/surfaces/credits-hub/hub-context";
import { RequestCreditsDialog, type RequestPrefill } from "@/surfaces/credits-hub/request-credits";
import {
  addDays,
  allowOneMore,
  cardLabel,
  claimReward,
  cycleOf,
  decideRequest,
  dismissMoment,
  fmtDate,
  meterOf,
  lotsOf,
  meterTimeline,
  packFor,
  planOf,
  preExpiry,
  replaceCardAndRetry,
  retryCharge,
  runHistory,
  topUpAllowed,
  updateCard,
  usualMix,
} from "@/core";

interface Moment {
  key: string;
  urgency: number;
  node: ReactNode;
}

const pctText = (p: number) => `${Math.round(p * 100)}%`;

export function MomentFeed({ limit = 4 }: { limit?: number }) {
  const { t, account, viewer, run, act, goTab } = useHub();
  const { fmtUsd, amountText, charged, note } = useMoney();
  const pay = usePay();
  const [all, setAll] = useState(false);
  const [ask, setAsk] = useState<RequestPrefill | null>(null);
  const pack = t.pack;
  const hub = t.hub[account];
  const plan = planOf(pack, hub.planId);
  const { start, end } = cycleOf(t);
  const enabled = new Set(pack.moments);
  const seen = (key: string) => !hub.dismissed[key];
  const dismiss = (key: string) => (reason: string) => run((s) => dismissMoment(s, account, key, reason).state, `Dismissed · ${reason}.`);
  const runs30 = useMemo(() => runHistory(t, account, 30), [t, account]);
  const canPay = viewer.can("payment");
  const canBuy = viewer.can("buy");
  const out: Moment[] = [];
  const updateCardNow = () => pay({ usd: 0, cardCheck: true, label: "New card", apply: (s) => replaceCardAndRetry(s, account, viewer.actor).state, okText: "New card on file. Anything unpaid was retried." });
  const requestFor = (meter: string, amount: number, reason: string) => setAsk({ meter, amount, reason });

  // Payment health first: a soft landing that holds, or runs paused after grace.
  const d = hub.dunning;
  if ((d.status === "grace" || d.status === "suspended") && enabled.has("soft-landing")) {
    const next = d.attempts.find((a) => a.outcome === "scheduled");
    out.push({
      key: "dunning",
      urgency: d.status === "suspended" ? 100 : 95,
      node: (
        <MomentCard
          tone={d.status === "suspended" ? "blocked" : "atRisk"}
          trigger={d.status === "suspended" ? "Billing · grace window ended" : "Billing · renewal not collected"}
          headline={d.status === "suspended" ? `Runs are paused until the ${fmtUsd(d.amount)} renewal is paid` : `Your ${fmtUsd(d.amount)} renewal didn't go through. Nothing is paused.`}
          evidence={
            d.status === "suspended"
              ? `Credits kept working through the grace window, which ended ${fmtDate(d.graceUntil!)}. Usage, invoices and exports stay open.`
              : `${d.attempts[0]?.note ?? "The card was declined"}. Credits keep working until ${fmtDate(d.graceUntil!)}${next ? `; the next automatic retry is ${fmtDate(next.at)}` : ""}.`
          }
          primary={canPay ? { label: "Update card and retry", onClick: updateCardNow } : { label: `${hub.team.find((m) => m.role === "admin")?.name ?? "Your admin"} has been told`, onClick: () => undefined, disabled: true, hint: "Only Admin and Billing roles can change the card" }}
          secondary={canPay ? { label: "See retry timeline", onClick: () => goTab("billing") } : undefined}
        />
      ),
    });
  }

  for (const r of hub.runs) {
    if (r.status !== "paused" || !enabled.has("mid-run")) continue;
    const key = `mid-run:${r.id}:${r.done}`;
    if (!seen(key)) continue;
    const why = r.pausedReason?.code === "insufficient_balance" ? `${meterOf(pack, r.pausedReason.meter).label} ran out` : r.pausedReason?.code === "spend_limit" ? "A blocking spend limit was reached" : r.pausedReason?.code === "payment_overdue" ? "The renewal is unpaid" : "It was paused";
    out.push({
      key,
      urgency: 90,
      node: (
        <MomentCard
          tone="atRisk"
          trigger={`Run · paused mid-run · ${r.table}`}
          headline={`Paused at row ${r.done.toLocaleString("en-US")} of ${r.rows.toLocaleString("en-US")}, nothing lost`}
          evidence={
            r.pausedReason?.code === "spend_limit"
              ? `${r.pausedReason.target}'s blocking limit stopped ${r.column}. The ${r.done.toLocaleString("en-US")} enriched rows are saved. ${viewer.can("approve") ? "Approve their request or raise the limit, and the run picks up where it stopped." : "Ask an admin for more and resume once they approve."}`
              : `${why} while adding ${r.column}. The ${r.done.toLocaleString("en-US")} enriched rows are saved and the rest wait for you. Pick how to finish: ${viewer.can("buy") ? "top up" : "request credits"}, wait for the reset on ${fmtDate(end)}, use your own key, run fewer rows${viewer.can("plan") ? " or upgrade" : ""}.`
          }
          primary={{ label: "See options", onClick: () => goTab("tables") }}
          onDismiss={dismiss(key)}
        />
      ),
    });
  }

  if (hub.capAsk && enabled.has("auto-cap")) {
    const ask0 = hub.capAsk;
    out.push({
      key: "cap",
      urgency: 85,
      node: (
        <MomentCard
          tone="watch"
          trigger="Auto top-up · monthly cap reached"
          headline={`Auto top-up stopped at your ${fmtUsd(hub.topUpCap, 0)} monthly cap`}
          evidence={`The next top-up (${fmtUsd(ask0.usd)}) would take this month past the cap, so it was held on ${fmtDate(ask0.at)}. Runs carry on with the balance you have.`}
          primary={canBuy ? { label: `Allow one more (${charged(ask0.usd)})`, onClick: () => run((s) => allowOneMore(s, account, viewer.actor).state, `Cap raised by ${fmtUsd(ask0.usd)} for this month.`) } : { label: "Ask an admin", onClick: () => requestFor(hub.autoTopUp.meter, hub.autoTopUp.units, "Auto top-up hit the monthly cap mid-month.") }}
          secondary={canBuy ? { label: "Change the cap", onClick: () => goTab("topups") } : undefined}
        />
      ),
    });
  }

  if (enabled.has("request-credits")) {
    const pending = hub.requests.filter((r) => r.status === "pending");
    if (viewer.can("approve") && pending.length) {
      const r = pending[0];
      const m = meterOf(pack, r.meter);
      out.push({
        key: `rq:${r.id}`,
        urgency: 80,
        node: (
          <MomentCard
            tone="info"
            trigger={`Requests · ${pending.length} waiting for you`}
            headline={`${r.fromName} asked for ${amountText(m, r.amount)}`}
            evidence={`"${r.reason}" About ${fmtUsd(r.usd)} at your top-up price if the balance doesn't cover it. Sent ${fmtDate(r.ts)}.`}
            primary={{ label: "Approve", onClick: () => act((s) => decideRequest(s, account, r.id, true, viewer.actor), (x) => ({ ok: x.ok, text: x.ok ? `Approved. ${x.note}` : x.note })) }}
            secondary={{ label: "Decline", onClick: () => act((s) => decideRequest(s, account, r.id, false, viewer.actor), (x) => ({ ok: x.ok, text: x.ok ? `${r.fromName}'s request declined.` : x.note })) }}
          />
        ),
      });
    }
    const mine = hub.requests.filter((r) => r.from === viewer.id).slice(-1)[0];
    if (!viewer.can("approve") && mine && seen(`rq-mine:${mine.id}:${mine.status}`)) {
      const m = meterOf(pack, mine.meter);
      out.push({
        key: `rq-mine:${mine.id}`,
        urgency: mine.status === "pending" ? 60 : 40,
        node: (
          <MomentCard
            tone={mine.status === "approved" ? "healthy" : mine.status === "declined" ? "neutral" : "info"}
            trigger="Requests · yours"
            headline={mine.status === "pending" ? `Your request for ${amountText(m, mine.amount)} is with the admins` : mine.status === "approved" ? `Approved: ${amountText(m, mine.amount)}` : "Your request was declined"}
            evidence={mine.status === "pending" ? `Sent ${fmtDate(mine.ts)}. You'll see it here and by e-mail as soon as someone decides.` : mine.note ?? ""}
            primary={{ label: "Open Tables", onClick: () => goTab("tables") }}
            onDismiss={dismiss(`rq-mine:${mine.id}:${mine.status}`)}
          />
        ),
      });
    }
  }

  const failed = hub.charges.find((c) => c.status === "failed" && c.meter);
  const failedKey = `payment-failed:${failed?.id}`;
  if (failed && enabled.has("payment-failed") && seen(failedKey) && canPay) {
    const cardOk = hub.card.status === "ok";
    out.push({
      key: failedKey,
      urgency: 75,
      node: (
        <MomentCard
          tone="blocked"
          trigger="Payments · top-up declined"
          headline={`${note(failed.description)} failed on ${fmtDate(failed.ts)}`}
          evidence={`${failed.reason}. ${hub.backupCard ? `Your backup ${cardLabel(hub.backupCard)} is used automatically next time.` : "Add a backup method in Billing so this falls back automatically."}`}
          primary={cardOk ? { label: `Retry ${charged(failed.amount)}`, onClick: () => pay({ usd: failed.amount, label: note(failed.description), apply: (s) => retryCharge(s, account, failed.id).state, okText: `${charged(failed.amount)} collected.` }) } : { label: `Replace ${cardLabel(hub.card)}`, onClick: () => pay({ usd: 0, cardCheck: true, label: "New card", apply: (s) => updateCard(s, account).state, okText: "New card on file." }) }}
          onDismiss={dismiss(failedKey)}
        />
      ),
    });
  }

  // Thresholds (80, 90, 100% by default) then the forecast: calm, specific, one action.
  let thresholdShown = false;
  if (enabled.has("threshold")) {
    const levels = [...pack.hub.thresholds].sort((a, b) => b - a);
    for (const m of pack.meters) {
      const tl = meterTimeline(t, account, m.id);
      const allow = tl.available;
      if (allow <= 0) continue;
      const used = tl.used;
      const pct = used / allow;
      const level = levels.find((l) => pct * 100 >= l);
      if (!level) continue;
      const key = `threshold:${m.id}:${level}:${t.cycleNo}`;
      if (!seen(key)) continue;
      const mix = usualMix(pack, runs30, m.id, tl.balance);
      const allowed = topUpAllowed(pack, m.id, plan, "cockpit");
      const choice = packFor(pack, m.id, Math.max(1, allow * 0.25));
      thresholdShown = true;
      out.push({
        key,
        urgency: level >= 100 ? 70 : level >= 90 ? 60 : 50,
        node: (
          <MomentCard
            tone={level >= 100 ? "atRisk" : "watch"}
            trigger={`Usage · ${level}% of ${m.label}`}
            headline={level >= 100 ? `You've used all of this cycle's ${m.label}` : `You've used ${pctText(Math.min(pct, 0.99))} of this cycle's ${m.label}`}
            evidence={`${amountText(m, used)} of the ${amountText(m, allow)} available this cycle. ${tl.balance > 0 ? `${amountText(m, tl.balance)} left${mix ? `, enough for about ${mix.n.toLocaleString("en-US")} ${mix.noun} at your usual mix` : ""}. ` : ""}Resets ${fmtDate(end)}.`}
            primary={
              !viewer.can("buy")
                ? { label: "Request credits", onClick: () => requestFor(m.id, Math.round(allow * 0.25), `${m.label} at ${pctText(pct)} on day ${cycleOf(t).day + 1}; need more to finish this cycle's tables.`) }
                : allowed && choice
                  ? { label: `Top up ${amountText(m, choice.pack.units * choice.count)}`, onClick: () => goTab("topups") }
                  : { label: "See your options", onClick: () => goTab(account === "maya" ? "lifecycle" : "plan") }
            }
            onDismiss={dismiss(key)}
          />
        ),
      });
      break;
    }
  }

  if (!thresholdShown && enabled.has("run-out-forecast")) {
    const soon = pack.meters.map((m) => ({ m, tl: meterTimeline(t, account, m.id) })).find((x) => x.tl.runsOutDay != null && !x.tl.ranOutAt);
    const key = `run-out-forecast:${soon?.m.id}:${t.cycleNo}`;
    if (soon && seen(key)) {
      const range = soon.tl.runsOutEarly != null && soon.tl.runsOutLate != null && soon.tl.runsOutEarly !== soon.tl.runsOutLate ? ` (likely between ${fmtDate(addDays(start, soon.tl.runsOutEarly))} and ${fmtDate(addDays(start, soon.tl.runsOutLate))})` : "";
      out.push({
        key,
        urgency: 55,
        node: (
          <MomentCard
            tone="watch"
            trigger="Forecast · run-out before reset"
            headline={`At this pace you run out of ${soon.m.label} on ${fmtDate(addDays(start, soon.tl.runsOutDay!))}`}
            evidence={`${amountText(soon.m, soon.tl.balance)} left at about ${amountText(soon.m, soon.tl.rate, { label: false })} a day${range}. Reset is ${fmtDate(end)}.`}
            primary={canBuy ? { label: hub.autoTopUp.enabled ? "Review auto top-up" : "Set up auto top-up", onClick: () => goTab("topups") } : { label: "Request credits", onClick: () => requestFor(soon.m.id, Math.round(soon.tl.rate * 7), `Forecast says ${soon.m.label} run out on ${fmtDate(addDays(start, soon.tl.runsOutDay!))}.`) }}
            onDismiss={dismiss(key)}
          />
        ),
      });
    }
  }

  const deadKey = `card-expired:${hub.card.last4}`;
  if (hub.card.status !== "ok" && canPay && enabled.has("card-expiring") && seen(deadKey) && d.status !== "grace" && d.status !== "suspended") {
    out.push({
      key: deadKey,
      urgency: 72,
      node: (
        <MomentCard
          tone="watch"
          trigger="Billing · default card expired"
          headline={`Your default ${cardLabel(hub.card)} has expired`}
          evidence={hub.backupCard?.status === "ok" ? `Your backup ${cardLabel(hub.backupCard)} is covering payments for now${hub.charges.some((c) => c.reason?.includes("backup")) ? ", and has already paid one top-up" : ""}. Update the default so the backup stays a backup.` : `Renewals and top-ups will fail until a valid card is on file. Renewal is ${fmtDate(end)}.`}
          primary={{ label: "Update card", onClick: updateCardNow }}
          onDismiss={dismiss(deadKey)}
        />
      ),
    });
  }

  const pe = preExpiry(hub, t.clock, pack.hub.dunning.preExpiryDays);
  const peKey = `card-expiring:${pe?.card.last4}:${pe?.card.expires}`;
  if (pe && canPay && enabled.has("card-expiring") && seen(peKey)) {
    out.push({
      key: peKey,
      urgency: 45,
      node: (
        <MomentCard
          tone="watch"
          trigger={`Billing · ${pe.which === "backup" ? "backup " : ""}card expires in ${pe.daysLeft} days`}
          headline={`Your ${cardLabel(pe.card)} expires on ${fmtDate(pe.expiresAt)}`}
          evidence={`Renewal on ${fmtDate(end)} and any auto top-ups go to this card. Updating now takes one step; nothing is charged.`}
          primary={{ label: "Update card", onClick: updateCardNow }}
          onDismiss={dismiss(peKey)}
        />
      ),
    });
  }

  // Lots that expire before the normal reset (rewards, promos, dated top-ups): the reset itself isn't news.
  const soonMs = new Date(t.clock).getTime() + pack.rules.expiringSoonDays * 86_400_000;
  const exp = pack.meters
    .map((m) => {
      const ls = lotsOf(t.ledger, account, m.id).filter((l) => l.expiresAt && new Date(l.expiresAt).getTime() < Math.min(end.getTime() - 3_600_000, soonMs));
      return { m, amount: ls.reduce((s0, l) => s0 + l.remaining, 0), firstAt: ls.map((l) => l.expiresAt!).sort()[0] ?? null };
    })
    .find((x) => x.amount >= 1 && x.firstAt);
  const expKey = `expiring-soon:${exp?.m.id}:${exp?.firstAt}`;
  if (exp && enabled.has("expiring-soon") && seen(expKey)) {
    out.push({
      key: expKey,
      urgency: 35,
      node: (
        <MomentCard
          tone="watch"
          trigger="Ledger · credits expiring"
          headline={`${amountText(exp.m, exp.amount)} expire on ${fmtDate(exp.firstAt!)}`}
          evidence="Runs spend rewards and promos first, then the credits soonest to expire, then top-ups, so the next run uses these before anything else."
          primary={{ label: "Open Tables", onClick: () => goTab("tables") }}
          onDismiss={dismiss(expKey)}
        />
      ),
    });
  }

  const reward = pack.rewards.find((r) => !r.pending && !hub.rewards.includes(r.id));
  const rewardKey = `reward-available:${reward?.id}`;
  if (reward && enabled.has("reward-available") && seen(rewardKey) && viewer.role !== "member") {
    const rm = meterOf(pack, reward.meter);
    out.push({
      key: rewardKey,
      urgency: 15,
      node: (
        <MomentCard
          tone="reward"
          trigger="Rewards · ready to claim"
          headline={`${reward.label}: +${amountText(rm, reward.amount)}`}
          evidence={reward.expiryDays ? `Reward credits last ${reward.expiryDays} days and are spent first.` : "Reward credits do not expire."}
          primary={{ label: "Claim", onClick: () => run((s) => claimReward(s, account, reward.id).state, `+${amountText(rm, reward.amount)} from ${reward.label}.`) }}
          onDismiss={dismiss(rewardKey)}
        />
      ),
    });
  }

  // Custom moments composed in the Workbench (Phase 7 §7.4): the live version when its trigger
  // holds and the frequency-cap window has not been dismissed, or the latest version in preview.
  const TAB: Record<string, HubTab> = { "open-topups": "topups", "open-plan": "plan", "open-billing": "billing", "open-usage": "usage" };
  for (const pm of t.platform?.portal.moments ?? []) {
    const def = pm.previewing ? latestDef(pm) : liveDef(pm);
    if (!def) continue;
    const ev = evaluateMoment(t, def, account);
    if (!ev.audience) continue;
    const key = capWindow(def, t.clock);
    if (!pm.previewing && (!ev.fires || !seen(key))) continue;
    out.push({
      key: `custom-${pm.id}`,
      urgency: pm.previewing ? 99 : def.tone === "atRisk" ? 90 : 70,
      node: (
        <MomentCard
          tone={def.tone}
          trigger={pm.previewing ? `Preview · v${def.version} · not live${ev.fires ? "" : " · trigger not met now"}` : `${ev.reason.split(" (")[0]}`}
          headline={ev.headline}
          evidence={def.blocks.find((b) => b.kind === "body")?.text ?? ""}
          primary={{ label: def.primaryAction.label, onClick: () => goTab(TAB[def.primaryAction.action] ?? "usage") }}
          onDismiss={pm.previewing ? undefined : dismiss(key)}
        />
      ),
    });
  }
  out.sort((a, b) => b.urgency - a.urgency);
  const shown = all ? out : out.slice(0, limit);
  return (
    <section aria-label="What needs attention" className="space-y-3">
      {out.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border p-4 type-body text-muted-foreground">Nothing needs you right now. Balances cover the cycle and payments are up to date.</div>
      ) : (
        shown.map((m) => <div key={m.key}>{m.node}</div>)
      )}
      {out.length > limit && (
        <Button variant="ghost" size="sm" onClick={() => setAll((v) => !v)}>
          {all ? "Show fewer" : `Show ${out.length - limit} more`}
        </Button>
      )}
      {ask && <RequestCreditsDialog open onOpenChange={(v) => !v && setAsk(null)} prefill={ask} />}
    </section>
  );
}
