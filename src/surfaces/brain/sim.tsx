import { CalendarClock, FastForward, Hourglass, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { SectionTitle, Stat } from "@/ui/primitives";
import { ToneBadge } from "@/ui/tone";
import { LedgerTable } from "@/ui/ledger-table";
import { amountText, fmtDate, fmtDateTime } from "@/core/format";
import { balanceOf, cycleOf, heldOf, CYCLE_DAYS, planOf, settleHolds, PAYMENT_SCENARIOS, paymentScenario, CANCEL_REASONS, type TenantState } from "@/core";
import { useState } from "react";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { advanceDay, seedTenant } from "@/sim/seed";
import { HUB_PERSONAS } from "@/tenants/personas";
import { useConfirm } from "@/hooks/use-confirm";

type Run = (fn: (s: TenantState) => TenantState, ok: string) => void;

export function SimTab({ t, run }: { t: TenantState; run: Run }) {
  const pack = t.pack;
  const confirm = useConfirm();
  const { start, end, day, clock } = cycleOf(t);
  const recent = t.ledger.slice(-60);
  const name = (id: string) => (id === "dev" ? "Dev" : id === "maya" ? "Maya" : id);
  const holds = HUB_PERSONAS.filter((id) => pack.meters.some((m) => heldOf(t.ledger, id, m.id) > 0));

  const advance = (days: number) =>
    run((s) => {
      let x = s;
      for (let i = 0; i < days; i++) x = advanceDay(x);
      return x;
    }, `Advanced ${days} day${days === 1 ? "" : "s"}.`);

  const reseed = async () => {
    if (!(await confirm({ title: `Re-seed ${pack.company}?`, description: "The current cycle is replayed from the pack as it is now. Ledger entries, events and approvals for this tenant are replaced.", confirmLabel: "Re-seed", destructive: true }))) return;
    run((s) => ({ ...seedTenant(s.pack, s.clock, s.custom), experiments: s.experiments, saves: s.saves, population: s.population, growth: s.growth, platform: s.platform }), "Cycle re-seeded from the current pack.");
  };

  return (
    <div className="space-y-6">
      <section aria-labelledby="clock-title" className="space-y-4 rounded-xl border border-border bg-card p-5">
        <SectionTitle id="clock-title" aside="Moves every account in this tenant">
          Clock
        </SectionTitle>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Stat label="Now" value={fmtDate(clock)} sub={fmtDateTime(t.clock).split(",").pop()?.trim()} />
          <Stat label="Cycle" value={`Day ${day + 1} of ${CYCLE_DAYS}`} sub={`${fmtDate(start)} – ${fmtDate(end)}`} />
          <Stat label="Cycles so far" value={t.cycleNo} />
          <Stat label="Ledger entries" value={t.ledger.length} sub={`${t.events.length} events`} />
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={() => advance(1)}>
            <CalendarClock aria-hidden="true" />
            Advance 1 day
          </Button>
          <Button size="sm" variant="outline" onClick={() => advance(7)}>
            <FastForward aria-hidden="true" />
            Advance 7 days
          </Button>
          <Button size="sm" variant="outline" onClick={() => advance(Math.max(1, CYCLE_DAYS - day))}>
            <FastForward aria-hidden="true" />
            Advance to renewal
          </Button>
          <Button size="sm" variant="ghost" onClick={() => void reseed()}>
            <RefreshCw aria-hidden="true" />
            Re-seed cycle from pack
          </Button>
        </div>
        <p className="type-caption text-muted-foreground">
          Each day settles in-flight runs, runs the day's schedule (auto top-ups included) and posts daily grants. At renewal, grants expire or roll over by the pack's rules, plan changes take effect and the invoice is charged.
        </p>
      </section>

      <PaymentStates t={t} run={run} />
      <ExitSurveys t={t} />
      <section aria-labelledby="bal-title" className="space-y-3">
        <SectionTitle id="bal-title" aside={holds.length ? `${holds.length} account${holds.length === 1 ? "" : "s"} with runs in flight` : "No runs in flight"}>
          Balances
        </SectionTitle>
        <Table>
          <TableCaption className="sr-only">Balances and holds by account and meter</TableCaption>
          <TableHeader>
            <TableRow>
              <TableHead scope="col">Account</TableHead>
              <TableHead scope="col">Plan</TableHead>
              {pack.meters.map((m) => (
                <TableHead key={m.id} scope="col" className="text-right">
                  {m.label}
                </TableHead>
              ))}
              <TableHead scope="col" className="text-right">
                Held
              </TableHead>
              <TableHead scope="col">
                <span className="sr-only">Actions</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {HUB_PERSONAS.map((id) => {
              const held = pack.meters.map((m) => ({ m, v: heldOf(t.ledger, id, m.id) })).filter((x) => x.v > 0);
              return (
                <TableRow key={id}>
                  <TableHead scope="row">{name(id)}</TableHead>
                  <TableCell>{planOf(pack, t.hub[id].planId).name}</TableCell>
                  {pack.meters.map((m) => (
                    <TableCell key={m.id} className="text-right num">
                      {amountText(m, balanceOf(t.ledger, id, m.id), { label: false })}
                    </TableCell>
                  ))}
                  <TableCell className="text-right num">{held.length ? held.map((x) => amountText(x.m, x.v)).join(" · ") : "—"}</TableCell>
                  <TableCell className="text-right">
                    {held.length > 0 ? (
                      <Button size="xs" variant="outline" onClick={() => run((s) => settleHolds(s, id).state, `${name(id)}'s in-flight run finished and was metered.`)}>
                        <Hourglass aria-hidden="true" />
                        Settle hold
                      </Button>
                    ) : (
                      <ToneBadge tone="neutral">Idle</ToneBadge>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </section>

      <section aria-labelledby="recent-title" className="space-y-3">
        <SectionTitle id="recent-title" aside="Last 60 entries">
          Recent ledger activity
        </SectionTitle>
        <LedgerTable pack={pack} entries={recent} accountName={name} pageSize={15} dense caption="Recent ledger entries, newest first" />
      </section>
    </div>
  );
}

/** Put an account into each payment state (Phase 2 §2.10): pre-expiry, backup fallback, soft landing, grace ended. */
function PaymentStates({ t, run }: { t: TenantState; run: Run }) {
  const [account, setAccount] = useState<"maya" | "dev">("dev");
  const hub = t.hub[account];
  return (
    <section aria-labelledby="pay-title" className="space-y-3 rounded-xl border border-border bg-card p-5">
      <SectionTitle
        id="pay-title"
        aside={
          <NativeSelect size="sm" aria-label="Account for payment states" value={account} onChange={(e) => setAccount(e.target.value as "maya" | "dev")}>
            {HUB_PERSONAS.map((id) => (
              <NativeSelectOption key={id} value={id}>
                {id === "dev" ? "Dev" : "Maya"} · {planOf(t.pack, t.hub[id].planId).name}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        }
      >
        Payment states
      </SectionTitle>
      <p className="type-caption text-muted-foreground">
        Now: {hub.dunning.status === "ok" ? "healthy" : hub.dunning.status === "grace" ? `soft landing until ${fmtDate(hub.dunning.graceUntil!)}` : hub.dunning.status} · default {hub.card.brand} ending {hub.card.last4} ({hub.card.status}, {hub.card.expires}){hub.backupCard ? ` · backup ${hub.backupCard.brand} ending ${hub.backupCard.last4}` : " · no backup"}
      </p>
      <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
        {PAYMENT_SCENARIOS.map((x) => (
          <li key={x.id} className="flex flex-col justify-between gap-2 rounded-lg border border-border p-3">
            <div>
              <div className="type-body font-medium">{x.label}</div>
              <div className="type-caption text-muted-foreground">{x.detail}</div>
            </div>
            <Button size="sm" variant="outline" disabled={!planOf(t.pack, hub.planId).paid && x.id !== "card-expiring" && x.id !== "clear"} onClick={() => run((s) => paymentScenario(s, account, x.id).state, `${account === "dev" ? "Dev" : "Maya"}: ${x.label.toLowerCase()}.`)}>
              Apply
            </Button>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Cancel and pause reasons with the offer shown and the outcome: the data the Workbench reads. */
function ExitSurveys({ t }: { t: TenantState }) {
  if (!t.exitSurveys.length) return null;
  const label = (r: string) => CANCEL_REASONS.find((x) => x.id === r)?.label ?? r;
  return (
    <section aria-labelledby="exit-title" className="space-y-3">
      <SectionTitle id="exit-title" aside={`${t.exitSurveys.length} recorded`}>
        Cancel and pause reasons
      </SectionTitle>
      <div className="overflow-x-auto rounded-xl border border-border">
        <Table>
          <TableCaption className="sr-only">Exit survey answers, newest first</TableCaption>
          <TableHeader>
            <TableRow>
              <TableHead>When</TableHead>
              <TableHead>Account</TableHead>
              <TableHead>Reason</TableHead>
              <TableHead>Offer shown</TableHead>
              <TableHead>Outcome</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {t.exitSurveys
              .slice()
              .reverse()
              .map((e) => (
                <TableRow key={e.id}>
                  <TableCell className="num whitespace-nowrap">{fmtDateTime(e.ts)}</TableCell>
                  <TableCell>{e.account === "dev" ? "Dev" : "Maya"} · {planOf(t.pack, e.plan).name}</TableCell>
                  <TableCell>{label(e.reason)}</TableCell>
                  <TableCell>{e.offer ?? "None"}</TableCell>
                  <TableCell>
                    <ToneBadge tone={e.outcome === "accepted" || e.outcome === "kept" ? "healthy" : e.outcome === "cancelled" ? "watch" : "neutral"}>{e.outcome}</ToneBadge>
                  </TableCell>
                </TableRow>
              ))}
          </TableBody>
        </Table>
      </div>
    </section>
  );
}

export function ApprovalsTab({ t }: { t: TenantState }) {
  return (
    <section aria-labelledby="appr-title" className="space-y-3">
      <SectionTitle id="appr-title" aside="Agent changes a person approved or rejected for this tenant">
        Approvals
      </SectionTitle>
      {t.approvals.length ? (
        <Table>
          <TableCaption className="sr-only">Approvals, newest first</TableCaption>
          <TableHeader>
            <TableRow>
              <TableHead scope="col">Audit id</TableHead>
              <TableHead scope="col">When</TableHead>
              <TableHead scope="col">Change</TableHead>
              <TableHead scope="col">By</TableHead>
              <TableHead scope="col">Risk</TableHead>
              <TableHead scope="col">Decision</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {t.approvals.map((a) => (
              <TableRow key={a.id + a.ts}>
                <TableHead scope="row" className="font-mono type-caption font-normal">
                  {a.id}
                </TableHead>
                <TableCell className="whitespace-nowrap num">{fmtDateTime(a.ts)}</TableCell>
                <TableCell>
                  <div className="font-medium">{a.title}</div>
                  <div className="type-caption text-muted-foreground">{a.summary}</div>
                </TableCell>
                <TableCell>{a.actor}</TableCell>
                <TableCell>
                  <ToneBadge tone={a.risk === "high" ? "blocked" : a.risk === "medium" ? "watch" : "healthy"}>{a.risk}</ToneBadge>
                </TableCell>
                <TableCell>
                  <ToneBadge tone={a.decision === "approved" ? "healthy" : "blocked"}>{a.decision}</ToneBadge>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      ) : (
        <p className="type-body text-muted-foreground">No approvals for this tenant yet. Onboarding a tenant from the Workbench records one.</p>
      )}
    </section>
  );
}
