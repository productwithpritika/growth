// Rewards (Phase 2 §2.8): Daily Spark for a qualifying action (not a login), badges with a
// one-line reason, and the anti-abuse rules every grant passes: one wallet per verified domain,
// velocity limits, a reason code on every grant. Shown honestly: no slot-machine animation.
import { Award, BadgeCheck, Flame, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { SectionTitle, UsageBar } from "@/ui/primitives";
import { ToneBadge } from "@/ui/tone";
import { useMoney } from "@/ui/money";
import { useHub } from "@/surfaces/credits-hub/hub-context";
import { claimReward, cycleOf, fmtDate, fmtDateTime, meterOf, sparkStatus, verifyDomain } from "@/core";

const BADGE_HOW: Record<string, string> = {
  "verify-first": "Run a work-email column with verification before a sequence",
  estimator: "Confirm a run from the estimator in Tables",
  "own-key": "Finish or start a run on your own API key",
  workflow: "Save a table as a workflow someone else reruns",
  teammate: "Invite a teammate who runs their first table",
  "bad-record": "Report a wrong record from 'Why this cost' in Usage",
};

export function RewardsTab() {
  const { t, account, viewer, run, goTab } = useHub();
  const { amountText } = useMoney();
  const pack = t.pack;
  const hub = t.hub[account];
  const s = sparkStatus(t, account);
  const sm = meterOf(pack, s.meter);
  const rs = hub.rewardState;
  const rules = pack.hub.antiAbuse;
  const domain = hub.profile.email.split("@")[1] ?? "your domain";
  const grants = t.ledger.filter((e) => e.account === account && e.kind === "grant" && e.source === "reward").slice().reverse();
  const { end } = cycleOf(t);

  return (
    <div className="space-y-8">
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
        <section aria-labelledby="spark-h" className="space-y-4 rounded-xl border border-border bg-card p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <SectionTitle id="spark-h">{s.label}</SectionTitle>
              <p className="type-body text-muted-foreground">
                {s.enabled
                  ? `${amountText(sm, s.amount)} on any day you run an enrichment on ${s.minRows}+ ${pack.workUnit.many} that returns verified results. Spark credits are spent first and last ${s.expiryDays} days.`
                  : `${pack.company} doesn't run a daily reward.`}
              </p>
            </div>
            {s.enabled && <ToneBadge tone={s.grantedToday ? "reward" : "neutral"}>{s.grantedToday ? "Earned today" : "Not yet today"}</ToneBadge>}
          </div>
          {s.enabled && (
            <>
              <ol aria-label="Qualifying days, last 14" className="grid grid-cols-7 gap-1.5 sm:grid-cols-14">
                {s.last14.map((d) => (
                  <li key={d.day} className={`flex h-12 flex-col items-center justify-center rounded-md border type-caption ${d.granted ? "border-reward-ink/40 bg-reward-soft text-reward-ink" : d.qualified ? "border-border bg-muted" : "border-dashed border-border text-muted-foreground"}`}>
                    <span>{new Date(d.day).toLocaleDateString("en-GB", { weekday: "narrow" })}</span>
                    <span className="num">{Number(d.day.slice(8, 10))}</span>
                    <span className="sr-only">{d.granted ? `earned ${amountText(sm, s.amount)}` : d.qualified ? "qualified, cap reached" : "no qualifying run"}</span>
                  </li>
                ))}
              </ol>
              <dl className="grid gap-4 sm:grid-cols-3">
                <div>
                  <dt className="type-caption text-muted-foreground">Streak</dt>
                  <dd className="flex items-center gap-1.5 type-heading">
                    <Flame aria-hidden="true" className="size-4 text-reward-ink" />
                    {s.streak} day{s.streak === 1 ? "" : "s"}
                  </dd>
                </div>
                <div>
                  <dt className="type-caption text-muted-foreground">Unspent Spark credits</dt>
                  <dd className="type-heading num">{amountText(sm, s.unspent)}</dd>
                  {s.nextExpiry && <dd className="type-caption text-muted-foreground">first expires {fmtDate(s.nextExpiry)}</dd>}
                </div>
                <div>
                  <dt className="type-caption text-muted-foreground">This cycle</dt>
                  <dd className="type-heading num">
                    {amountText(sm, s.earnedThisCycle, { label: false })} / {amountText(sm, s.monthlyCap)}
                  </dd>
                  <dd>
                    <UsageBar value={s.earnedThisCycle} max={s.monthlyCap} label={`${s.label}: ${s.earnedThisCycle} of ${s.monthlyCap} this cycle`} />
                  </dd>
                </div>
              </dl>
              <p className="type-body">
                <span className="font-medium">Next reward: </span>
                {s.capLeft <= 0
                  ? `none this cycle; you've reached the ${amountText(sm, s.monthlyCap)} cap. It starts again ${fmtDate(end)}.`
                  : s.grantedToday
                    ? `tomorrow, ${amountText(sm, Math.min(s.amount, s.capLeft - s.amount > 0 ? s.amount : s.capLeft))} if you run a qualifying enrichment. Missing a day just restarts the streak; nothing is taken away.`
                    : `today, ${amountText(sm, Math.min(s.amount, s.capLeft))} when a run of ${s.minRows}+ ${pack.workUnit.many} returns verified results.`}
              </p>
              {s.refusedRule && <p className="type-body text-watch-ink">Today's Spark wasn't granted: {s.refusedRule}.</p>}
              {!s.grantedToday && s.capLeft > 0 && (
                <Button size="sm" variant="outline" onClick={() => goTab("tables")}>
                  Run a qualifying table
                </Button>
              )}
            </>
          )}
        </section>
        <section aria-labelledby="abuse-h" className="space-y-3">
          <SectionTitle id="abuse-h">Fair-play rules</SectionTitle>
          <ul className="space-y-2 rounded-xl border border-border bg-card p-4 type-body">
            <li className="flex gap-2">
              <ShieldCheck aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
              <div>
                One reward wallet per verified domain: <span className="font-medium">{domain}</span> {rs.domainVerified ? <ToneBadge tone="healthy">Verified</ToneBadge> : <ToneBadge tone="watch">Not verified</ToneBadge>}
                {!rs.domainVerified && viewer.can("plan") && (
                  <div className="mt-2">
                    <Button size="sm" variant="outline" onClick={() => run((st) => verifyDomain(st, account, viewer.actor).state, `${domain} verified. Rewards can be granted again.`)}>
                      Verify {domain}
                    </Button>
                  </div>
                )}
              </div>
            </li>
            <li className="flex gap-2">
              <ShieldCheck aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
              <span>
                At most {rules.maxGrantsPerDay} reward grants a day and {rules.maxGrantsPerWeek} a week.
              </span>
            </li>
            <li className="flex gap-2">
              <ShieldCheck aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
              <span>Every grant carries a reason code and lands in the ledger as a reward. Rewards attach to actions that keep data good, never to logging in.</span>
            </li>
          </ul>
          {rs.refused.length > 0 && (
            <ul className="space-y-1 type-caption text-muted-foreground">
              {rs.refused.slice(-4).reverse().map((r) => (
                <li key={r.at + r.what}>
                  {fmtDate(r.at)} · {r.what} not granted · {r.rule}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <section aria-labelledby="badges-h" className="space-y-3">
        <SectionTitle id="badges-h" aside={<span className="type-caption text-muted-foreground">Credit amounts for badges are set by {pack.company}'s experiments</span>}>
          Badges
        </SectionTitle>
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {pack.hub.badges.map((b) => {
            const got = rs.badges.find((x) => x.id === b.id);
            return (
              <li key={b.id} className={`flex gap-3 rounded-xl border p-4 ${got ? "border-reward-ink/30 bg-reward-soft/40" : "border-border bg-card"}`}>
                {got ? <BadgeCheck aria-hidden="true" className="size-5 shrink-0 text-reward-ink" /> : <Award aria-hidden="true" className="size-5 shrink-0 text-muted-foreground" />}
                <div className="min-w-0 space-y-0.5">
                  <div className="type-body font-medium">{b.label}</div>
                  <p className="type-caption">{b.reason}.</p>
                  <p className="type-caption text-muted-foreground">
                    {got ? `Earned ${fmtDate(got.at)}${b.amount ? ` · +${amountText(sm, b.amount)}` : ""}` : `How: ${BADGE_HOW[b.id] ?? b.reason}.`}
                  </p>
                </div>
              </li>
            );
          })}
        </ul>
      </section>

      {pack.rewards.length > 0 && (
        <section aria-labelledby="oneoff-h" className="space-y-3">
          <SectionTitle id="oneoff-h">One-off rewards</SectionTitle>
          <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {pack.rewards.map((r) => {
              const m = meterOf(pack, r.meter);
              const claimed = hub.rewards.includes(r.id);
              return (
                <li key={r.id} className="flex flex-col justify-between gap-3 rounded-xl border border-border bg-card p-4">
                  <div>
                    <div className="type-body font-medium">{r.label}</div>
                    <p className="type-caption text-muted-foreground">
                      +{amountText(m, r.amount)}
                      {r.expiryDays ? ` · lasts ${r.expiryDays} days` : ""}
                      {r.pending ? ` · ${r.pending}` : ""}
                    </p>
                  </div>
                  <Button size="sm" variant="outline" disabled={claimed || !!r.pending} onClick={() => run((st) => claimReward(st, account, r.id).state, `+${amountText(m, r.amount)} from ${r.label}.`)}>
                    {claimed ? "Claimed" : r.pending ? "Waiting" : "Claim"}
                  </Button>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <section aria-labelledby="grants-h" className="space-y-3">
        <SectionTitle id="grants-h">Reward grants in the ledger</SectionTitle>
        {grants.length === 0 ? (
          <p className="type-body text-muted-foreground">No reward grants yet.</p>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-border">
            <Table>
              <TableCaption className="sr-only">Reward grants with reason codes, newest first</TableCaption>
              <TableHeader>
                <TableRow>
                  <TableHead>When</TableHead>
                  <TableHead>What</TableHead>
                  <TableHead>Reason code</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead>Expires</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {grants.slice(0, 12).map((e) => (
                  <TableRow key={e.id}>
                    <TableCell className="whitespace-nowrap num">{fmtDateTime(e.ts)}</TableCell>
                    <TableCell>{e.note}</TableCell>
                    <TableCell>
                      <code className="type-caption">{e.reason}</code>
                    </TableCell>
                    <TableCell className="text-right num">+{amountText(meterOf(pack, e.meter), e.amount, { label: false })}</TableCell>
                    <TableCell className="num">{e.expiresAt ? fmtDate(e.expiresAt) : "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </section>
    </div>
  );
}
