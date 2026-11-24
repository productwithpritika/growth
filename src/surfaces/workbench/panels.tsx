import { useMemo, useState, type FormEvent } from "react";
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { SectionTitle, Stat } from "@/ui/primitives";
import { ToneBadge } from "@/ui/tone";
import { fmtNum, fmtPct, fmtUsd } from "@/core/format";
import { accountsFor } from "@/sim/population";
import {
  atRisk,
  inCohort,
  median,
  bestFit,
  grantRule,
  ladder,
  meterRevenue,
  monthlyAllowance,
  planCost,
  planOf,
  primaryMeter,
  secondaryMeter,
  setSave,
  topUpUnitPrice,
  updatePack,
  type Policy,
  type TenantState,
  type WorkbenchStats,
} from "@/core";
import type { WbRun } from "@/surfaces/workbench/page";

// ---------------- Churn arrest ----------------

export function ChurnPanel({ t, stats, run }: { t: TenantState; stats: WorkbenchStats; run: WbRun }) {
  const pack = t.pack;
  const risks = useMemo(() => atRisk(pack, stats.accounts), [pack, stats]);
  const [showAll, setShowAll] = useState(false);
  const [picks, setPicks] = useState<Record<string, string>>({});
  const shown = showAll ? risks : risks.slice(0, 12);
  const atRiskMrr = risks.reduce((s, r) => s + r.mrr, 0);
  const covered = risks.filter((r) => t.saves[r.account.id]);
  const coveredMrr = covered.reduce((s, r) => s + r.mrr, 0);
  const playLabel = (id: string) => pack.saves.find((p) => p.id === id)?.label ?? id;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-6 sm:grid-cols-4">
        <Stat label="Paid accounts at risk" value={fmtNum(risks.length)} sub={`of ${fmtNum(stats.paid.length)}`} />
        <Stat label="MRR at risk" value={fmtUsd(atRiskMrr, 0)} />
        <Stat label="Save plays applied" value={fmtNum(covered.length)} />
        <Stat label="MRR covered by a play" value={fmtUsd(coveredMrr, 0)} sub={atRiskMrr ? fmtPct(coveredMrr / atRiskMrr) : undefined} />
      </div>
      <section aria-labelledby="risk-title" className="space-y-3">
        <SectionTitle id="risk-title" aside={`Signals from Tenant Pack rules · usage down ${pack.rules.usageDropPct}%+, under ${pack.rules.idlePct}% used`}>
          At-risk accounts
        </SectionTitle>
        <Table>
          <TableCaption className="sr-only">Paid accounts with churn signals and the save play for each</TableCaption>
          <TableHeader>
            <TableRow>
              <TableHead scope="col">Account</TableHead>
              <TableHead scope="col">Plan</TableHead>
              <TableHead scope="col" className="text-right">MRR</TableHead>
              <TableHead scope="col">Signals</TableHead>
              <TableHead scope="col">Save play</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {shown.map((r) => {
              const applied = t.saves[r.account.id];
              const pick = picks[r.account.id] ?? r.suggested;
              return (
                <TableRow key={r.account.id}>
                  <TableHead scope="row">
                    <div className="font-medium">{r.account.name}</div>
                    <div className="text-xs font-normal text-muted-foreground">{r.account.id}</div>
                  </TableHead>
                  <TableCell>{planOf(pack, r.account.planId).name}</TableCell>
                  <TableCell className="text-right tabular-nums">{fmtUsd(r.mrr, 0)}</TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {r.signals.map((s) => (
                        <ToneBadge key={s} tone={s.startsWith("Payment") || s.startsWith("Opened") ? "blocked" : "watch"}>
                          {s}
                        </ToneBadge>
                      ))}
                    </div>
                  </TableCell>
                  <TableCell>
                    {applied ? (
                      <div className="flex items-center gap-2">
                        <ToneBadge tone="healthy">{playLabel(applied)}</ToneBadge>
                        <Button size="xs" variant="ghost" onClick={() => run((s) => setSave(s, r.account, null, "save play removed"), `Save play removed for ${r.account.name}.`)}>
                          Undo
                        </Button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2">
                        <NativeSelect size="sm" aria-label={`Save play for ${r.account.name}`} value={pick} onChange={(e) => setPicks((p) => ({ ...p, [r.account.id]: e.target.value }))}>
                          {pack.saves.map((p) => (
                            <NativeSelectOption key={p.id} value={p.id}>
                              {p.label}
                              {p.id === r.suggested ? " (suggested)" : ""}
                            </NativeSelectOption>
                          ))}
                        </NativeSelect>
                        <Button size="xs" onClick={() => run((s) => setSave(s, r.account, pick, playLabel(pick)), `${playLabel(pick)} applied to ${r.account.name}.`)}>
                          Apply
                        </Button>
                      </div>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
        {risks.length > 12 && (
          <Button variant="ghost" size="sm" aria-expanded={showAll} onClick={() => setShowAll((v) => !v)}>
            {showAll ? "Show top 12" : `Show all ${risks.length}`}
          </Button>
        )}
        <ul className="grid gap-2 text-sm sm:grid-cols-2 xl:grid-cols-4">
          {pack.saves.map((p) => (
            <li key={p.id} className="rounded-lg border border-border p-3">
              <div className="font-medium">{p.label}</div>
              <div className="text-xs text-muted-foreground">{p.detail}</div>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

// ---------------- Plan optimiser ----------------

const BUCKETS = [
  { label: "$0–10", max: 10 },
  { label: "$10–25", max: 25 },
  { label: "$25–50", max: 50 },
  { label: "$50–100", max: 100 },
  { label: "$100–200", max: 200 },
  { label: "$200+", max: Infinity },
];
const gapConfig = {
  today: { label: "Today", color: "var(--muted-foreground)" },
  cockpit: { label: "With proposals", color: "var(--chart-1)" },
} satisfies ChartConfig;

export function OptimiserPanel({ t, run }: { t: TenantState; run: WbRun }) {
  const pack = t.pack;
  const [policy, setPolicy] = useState<Policy>("cockpit");
  const data = useMemo(() => optimise(t), [t]);
  const lad = ladder(pack, policy);
  const cols = [...lad.filter((p) => p.price != null), ...pack.plans.filter((p) => p.price == null)];
  const rowsPlans = Object.keys(pack.demo.population.profiles).map((id) => planOf(pack, id));
  const m = data[policy];
  const proposedPlans = pack.plans.filter((p) => p.proposed);
  const proposedPacks = pack.topUpPacks.filter((x) => x.proposed);
  const free = pack.plans.find((p) => !p.paid);

  const savePlan = (id: string) => (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const price = Math.max(0, Number(f.get("price")) || 0);
    const included: Record<string, number> = {};
    for (const mt of pack.meters) included[mt.id] = Math.max(0, Number(f.get(`a-${mt.id}`)) || 0);
    run(
      (s) =>
        updatePack(s, (p) => {
          const pl = p.plans.find((x) => x.id === id);
          if (pl) {
            pl.price = price;
            pl.included = included;
          }
        }, `${planOf(pack, id).name}: ${fmtUsd(price, 0)}, ${pack.meters.map((mt) => `${fmtNum(included[mt.id])} ${mt.label}`).join(", ")}`),
      `${planOf(pack, id).name} updated in the Tenant Pack.`,
    );
  };

  const savePack = (id: string) => (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const price = Math.max(0, Number(f.get("price")) || 0);
    const units = Math.max(1, Number(f.get("units")) || 1);
    run(
      (s) =>
        updatePack(s, (p) => {
          const x = p.topUpPacks.find((y) => y.id === id);
          if (x) {
            x.price = price;
            x.units = units;
          }
        }, `Top-up pack ${id}: ${fmtNum(units)} for ${fmtUsd(price)}`),
      "Top-up pack updated in the Tenant Pack.",
    );
  };

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
      <div className="min-w-0 space-y-6">
        <div role="group" aria-label="Pricing policy" className="inline-flex rounded-lg border border-border p-1">
          {(["today", "cockpit"] as Policy[]).map((p) => (
            <Button key={p} size="sm" variant={policy === p ? "default" : "ghost"} aria-pressed={policy === p} onClick={() => setPolicy(p)}>
              {p === "today" ? "Today's ladder" : "With Cockpit proposals"}
            </Button>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-6 sm:grid-cols-4">
          <Stat label={pack.billingModel === "prepaid" ? "Monthly demand at current tiers" : "Paid MRR at current plans"} value={fmtUsd(m.mrrNow, 0)} />
          <Stat label={pack.billingModel === "prepaid" ? "Monthly demand at best-fit tiers" : "Paid MRR at best fit"} value={fmtUsd(m.mrrFit, 0)} sub={`${m.mrrFit >= m.mrrNow ? "+" : ""}${fmtUsd(m.mrrFit - m.mrrNow, 0)}`} />
          <Stat label="Paid, over-provisioned" value={fmtNum(m.over)} sub="best fit is cheaper" />
          <Stat label={`${free?.name ?? "Free"} at a cap`} value={fmtNum(m.freeNeedingMore)} sub={`median path ${m.freeMedian != null ? fmtUsd(m.freeMedian) : "custom"}/mo`} />
        </div>
        <section aria-labelledby="matrix-title" className="space-y-3">
          <SectionTitle id="matrix-title" aside="Cheapest plan that covers each account's monthly demand, top-ups included">
            Current plan → best-fit plan
          </SectionTitle>
          <Table>
            <TableCaption className="sr-only">Accounts by current plan and best-fit plan</TableCaption>
            <TableHeader>
              <TableRow>
                <TableHead scope="col">Current plan</TableHead>
                {cols.map((c) => (
                  <TableHead key={c.id} scope="col" className="text-right">
                    {c.name}
                    {c.proposed ? " *" : ""}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rowsPlans.map((r) => (
                <TableRow key={r.id}>
                  <TableHead scope="row">{r.name}</TableHead>
                  {cols.map((c) => {
                    const n = m.matrix[r.id]?.[c.id] ?? 0;
                    return (
                      <TableCell key={c.id} className={r.id === c.id ? "bg-muted text-right font-semibold tabular-nums" : "text-right tabular-nums"}>
                        {n ? fmtNum(n) : "·"}
                      </TableCell>
                    );
                  })}
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {proposedPlans.length > 0 && <p className="text-xs text-muted-foreground">* Proposed plan</p>}
        </section>
        <section aria-labelledby="gap-title" className="space-y-3 rounded-xl border border-border bg-card p-5">
          <SectionTitle id="gap-title" aside={`${fmtNum(data.today.capped)} capped ${free?.name ?? "free"} accounts`}>
            What a capped {free?.name ?? "free"} account must pay to keep working
          </SectionTitle>
          <p id="gap-summary" className="text-sm text-muted-foreground">
            Median {data.today.freeMedian != null ? fmtUsd(data.today.freeMedian, 0) : "custom"} a month today against {data.cockpit.freeMedian != null ? fmtUsd(data.cockpit.freeMedian) : "custom"} with proposals.
          </p>
          <ChartContainer config={gapConfig} className="aspect-auto h-[220px] w-full" role="img" aria-labelledby="gap-title" aria-describedby="gap-summary">
            <BarChart data={data.buckets} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid vertical={false} />
              <XAxis dataKey="label" tickLine={false} axisLine={false} />
              <YAxis width={36} tickLine={false} axisLine={false} allowDecimals={false} />
              <ChartTooltip content={<ChartTooltipContent />} />
              <Bar dataKey="today" fill="var(--color-today)" radius={[3, 3, 0, 0]} isAnimationActive={false} />
              <Bar dataKey="cockpit" fill="var(--color-cockpit)" radius={[3, 3, 0, 0]} isAnimationActive={false} />
            </BarChart>
          </ChartContainer>
          <Table>
            <TableCaption className="sr-only">Capped accounts by monthly cost bucket</TableCaption>
            <TableHeader>
              <TableRow>
                <TableHead scope="col">Monthly cost</TableHead>
                {data.buckets.map((b) => (
                  <TableHead key={b.label} scope="col" className="text-right">{b.label}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {(["today", "cockpit"] as const).map((k) => (
                <TableRow key={k}>
                  <TableHead scope="row" className="font-normal">
                    <span className="inline-flex items-center gap-2">
                      <span aria-hidden="true" className={k === "today" ? "size-2.5 rounded-sm bg-muted-foreground" : "size-2.5 rounded-sm bg-primary"} />
                      {k === "today" ? "Today" : "With proposals"}
                    </span>
                  </TableHead>
                  {data.buckets.map((b) => (
                    <TableCell key={b.label} className="text-right tabular-nums">{fmtNum(b[k])}</TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </section>
      </div>
      <aside aria-labelledby="levers-title" className="space-y-4">
        <SectionTitle id="levers-title">Proposal levers</SectionTitle>
        {proposedPlans.map((p) => (
          <form key={`${p.id}-${p.price}-${JSON.stringify(p.included)}`} onSubmit={savePlan(p.id)} className="space-y-3 rounded-xl border border-border bg-card p-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold">{p.name} plan</h3>
              <ToneBadge tone="info">Proposed</ToneBadge>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`price-${p.id}`}>Price per month (USD)</Label>
              <Input id={`price-${p.id}`} name="price" type="number" min={0} defaultValue={p.price ?? 0} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              {pack.meters.map((mt) => (
                <div key={mt.id} className="space-y-1.5">
                  <Label htmlFor={`a-${p.id}-${mt.id}`}>
                    {mt.label} {grantRule(pack, p.id, mt.id).cadence === "daily" ? "a day" : "a month"}
                  </Label>
                  <Input id={`a-${p.id}-${mt.id}`} name={`a-${mt.id}`} type="number" min={0} defaultValue={p.included[mt.id] ?? 0} />
                </div>
              ))}
            </div>
            <Button type="submit" size="sm">
              Apply to Tenant Pack
            </Button>
          </form>
        ))}
        {proposedPacks.map((tp) => {
          const mt = pack.meters.find((x) => x.id === tp.meter) ?? prim0(pack);
          const premium = mt.pricePerUnit > 0 ? Math.round((tp.price / tp.units / mt.pricePerUnit - 1) * 100) : 0;
          return (
            <form key={`${tp.id}-${tp.price}-${tp.units}`} onSubmit={savePack(tp.id)} className="space-y-3 rounded-xl border border-border bg-card p-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold">{mt.label} top-up pack</h3>
                <ToneBadge tone="info">Proposed</ToneBadge>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor={`u-${tp.id}`}>{mt.label}</Label>
                  <Input id={`u-${tp.id}`} name="units" type="number" min={1} defaultValue={tp.units} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor={`p-${tp.id}`}>Price (USD)</Label>
                  <Input id={`p-${tp.id}`} name="price" type="number" min={0} step="any" defaultValue={tp.price} />
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                {fmtUsd(tp.price / tp.units, 4)} each · {premium >= 0 ? `${premium}% over` : `${-premium}% under`} list · {tp.validityDays ? `valid ${tp.validityDays} days` : "no expiry"}
              </p>
              <Button type="submit" size="sm">
                Apply to Tenant Pack
              </Button>
            </form>
          );
        })}
        <p className="text-xs text-muted-foreground">
          With proposals, {free?.name ?? "free"} accounts can also buy top-ups. Changes here update the Credits Hub immediately.
        </p>
      </aside>
    </div>
  );
}

function prim0(pack: TenantState["pack"]) {
  return primaryMeter(pack);
}

function PremiumSlider({ id, value, label, onCommit, min = 0, max = 60, step = 5, format = (v: number) => `${v}%` }: { id: string; value: number; label: string; onCommit: (v: number) => void; min?: number; max?: number; step?: number; format?: (v: number) => string }) {
  const [v, setV] = useState(value);
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <Label id={`lbl-${id}`}>{label}</Label>
        <span className="text-sm font-semibold tabular-nums">{format(v)}</span>
      </div>
      <Slider aria-labelledby={`lbl-${id}`} min={min} max={max} step={step} value={[v]} onValueChange={(x) => setV(x[0])} onValueCommit={(x) => onCommit(x[0])} />
    </div>
  );
}

function optimise(t: TenantState) {
  const pack = t.pack;
  const accounts = accountsFor(pack);
  const capped = accounts.filter(inCohort(pack, "free-capped"));
  const res = {} as Record<Policy, { matrix: Record<string, Record<string, number>>; mrrNow: number; mrrFit: number; over: number; freeNeedingMore: number; freeMedian: number | null; capped: number; costs: (number | null)[] }>;
  for (const policy of ["today", "cockpit"] as Policy[]) {
    const matrix: Record<string, Record<string, number>> = {};
    let mrrNow = 0;
    let mrrFit = 0;
    let over = 0;
    for (const a of accounts) {
      const fit = bestFit(pack, a, policy);
      matrix[a.planId] ??= {};
      matrix[a.planId][fit.planId] = (matrix[a.planId][fit.planId] ?? 0) + 1;
      const plan = planOf(pack, a.planId);
      if (plan.paid) {
        const now = planCost(pack, a, plan, policy) ?? (plan.price ?? 0) + pack.meters.reduce((s, m) => s + Math.max(0, (a.demand[m.id] ?? 0) - monthlyAllowance(pack, plan.id, m.id)) * m.pricePerUnit, 0);
        mrrNow += now;
        mrrFit += fit.cost ?? now;
        if (fit.cost != null && fit.cost < (plan.price ?? 0) - 0.5) over++;
      }
    }
    const costs = capped.map((a) => bestFit(pack, a, policy).cost);
    const known = costs.filter((c): c is number => c != null).sort((x, y) => x - y);
    res[policy] = { matrix, mrrNow, mrrFit, over, freeNeedingMore: capped.length, freeMedian: known.length ? median(known) : null, capped: capped.length, costs };
  }
  const buckets = BUCKETS.map((b, i) => {
    const lo = i === 0 ? -1 : BUCKETS[i - 1].max;
    const count = (cs: (number | null)[]) => cs.filter((c) => c != null && c > lo && c <= b.max).length;
    return { label: b.label, today: count(res.today.costs), cockpit: count(res.cockpit.costs) };
  });
  return { ...res, buckets };
}


// ---------------- Unit economics ----------------

export function EconomicsPanel({ t, stats, run }: { t: TenantState; stats: WorkbenchStats; run: WbRun }) {
  const pack = t.pack;
  const prim = primaryMeter(pack);
  const sec = secondaryMeter(pack);
  const prepaid = pack.billingModel === "prepaid";
  const unit = topUpUnitPrice(pack, prim.id);
  const byPlan = Object.keys(pack.demo.population.profiles)
    .map((id) => planOf(pack, id))
    .filter((p) => p.paid)
    .map((p) => {
      const xs = stats.paid.filter((a) => a.planId === p.id);
      let mrr = 0, rev = 0, cogs = 0, units = 0, breakage = 0;
      const brk: Record<string, number> = {};
      for (const a of xs) {
        const pr = stats.projections.get(a.id)!;
        mrr += pr.revenue;
        rev += prepaid ? (pr.usage[prim.id] ?? 0) * prim.pricePerUnit : meterRevenue(pack, p, prim.id) + (pr.topUpUnits[prim.id] ?? 0) * (Number.isFinite(unit) ? unit : prim.pricePerUnit);
        cogs += (pr.usage[prim.id] ?? 0) * a.cogsPerUnit;
        units += pr.usage[prim.id] ?? 0;
        breakage += pr.breakageUsd;
        for (const m of pack.meters) brk[m.id] = (brk[m.id] ?? 0) + (pr.breakageUnits[m.id] ?? 0);
      }
      return { p, n: xs.length, mrr, revPer: units ? rev / units : 0, costPer: units ? cogs / units : 0, marginPct: rev ? (rev - cogs) / rev : 0, breakage, brk };
    });
  const rolloverRules = pack.grantRules.map((g, i) => ({ g, i })).filter(({ g }) => g.rollover.mode === "capped");
  const byok = stats.paid.filter((a) => a.byok >= pack.rules.byokHeavyPct / 100);
  const byokActions = stats.paid.reduce((s, a) => s + (stats.projections.get(a.id)?.usage[sec.id] ?? 0) * a.byok, 0);
  const recovered = byokActions * pack.agents.byokFee;
  const breakageByMeter = pack.meters.map((m) => ({ m, units: byPlan.reduce((s, r) => s + (r.brk[m.id] ?? 0), 0) }));

  return (
    <div className="space-y-6">
      <section aria-labelledby="margin-title" className="space-y-3">
        <SectionTitle id="margin-title" aside={`Provider cost from the rate card · ${prim.label} revenue includes top-ups`}>
          {prepaid ? "Margin on usage by tier" : `Margin per ${prim.label.replace(/s$/, "")} by plan`}
        </SectionTitle>
        <Table>
          <TableCaption className="sr-only">Unit economics by paid plan this cycle</TableCaption>
          <TableHeader>
            <TableRow>
              <TableHead scope="col">Plan</TableHead>
              <TableHead scope="col" className="text-right">Accounts</TableHead>
              <TableHead scope="col" className="text-right">MRR</TableHead>
              <TableHead scope="col" className="text-right">Revenue / {prepaid ? "dollar" : prim.label.replace(/s$/, "").toLowerCase()}</TableHead>
              <TableHead scope="col" className="text-right">Provider cost</TableHead>
              <TableHead scope="col" className="text-right">Margin</TableHead>
              <TableHead scope="col" className="text-right">Breakage</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {byPlan.map((r) => (
              <TableRow key={r.p.id}>
                <TableHead scope="row">{r.p.name}</TableHead>
                <TableCell className="text-right tabular-nums">{fmtNum(r.n)}</TableCell>
                <TableCell className="text-right tabular-nums">{fmtUsd(r.mrr, 0)}</TableCell>
                <TableCell className="text-right tabular-nums">{fmtUsd(r.revPer, 4)}</TableCell>
                <TableCell className="text-right tabular-nums">{fmtUsd(r.costPer, 4)}</TableCell>
                <TableCell className="text-right tabular-nums">
                  <ToneBadge tone={r.marginPct >= 0.5 ? "healthy" : r.marginPct >= 0.3 ? "watch" : "blocked"}>{fmtPct(r.marginPct)}</ToneBadge>
                </TableCell>
                <TableCell className="text-right tabular-nums">{fmtUsd(r.breakage, 0)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </section>
      <div className="grid gap-6 lg:grid-cols-2">
        <section aria-labelledby="breakage-title" className="space-y-4 rounded-xl border border-border bg-card p-5">
          <SectionTitle id="breakage-title" aside={`${fmtUsd(stats.breakageUsd, 0)} this cycle`}>
            Breakage pool
          </SectionTitle>
          <ul className="space-y-1 text-sm">
            {breakageByMeter.map(({ m, units }) => (
              <li key={m.id} className="flex justify-between gap-3">
                <span>{m.label} expiring unused</span>
                <span className="font-semibold tabular-nums">{fmtNum(units)}</span>
              </li>
            ))}
          </ul>
          <ul className="space-y-1 text-sm">
            {pack.grantRules.map((g, i) => (
              <li key={i} className="flex justify-between gap-3 text-muted-foreground">
                <span>
                  {g.plan === "*" ? "Other plans" : planOf(pack, g.plan).name} · {pack.meters.find((m) => m.id === g.meter)?.label ?? g.meter}
                </span>
                <span>
                  {g.cadence === "daily" ? "Daily grant" : "Monthly grant"} · {g.rollover.mode === "none" ? "no rollover" : g.rollover.mode === "full" ? "full rollover" : `rollover up to ${g.rollover.capX}×`}
                  {g.expiryDays ? ` · expires in ${g.expiryDays} days` : ""}
                </span>
              </li>
            ))}
          </ul>
          {rolloverRules.map(({ g, i }) => (
            <PremiumSlider
              key={`${i}-${g.rollover.capX}`}
              id={`roll-${i}`}
              value={g.rollover.capX}
              min={0}
              max={3}
              step={0.5}
              format={(v) => `${v}× allowance`}
              label={`${g.plan === "*" ? "Other plans" : planOf(pack, g.plan).name} · ${pack.meters.find((m) => m.id === g.meter)?.label ?? g.meter} rollover cap`}
              onCommit={(v) => run((s) => updatePack(s, (p) => { const x = p.grantRules[i]; if (x) x.rollover.capX = v; }, `Rollover cap ${v}×`), `Rollover cap set to ${v}× the allowance.`)}
            />
          ))}
        </section>
        {pack.byokDiscount && (
        <section aria-labelledby="byok-title" className="space-y-4 rounded-xl border border-border bg-card p-5">
          <SectionTitle id="byok-title" aside={`${fmtNum(byok.length)} paid accounts run ${pack.rules.byokHeavyPct}%+ of steps on own keys`}>
            Bring your own keys
          </SectionTitle>
          <div className="grid grid-cols-2 gap-4">
            <Stat label={`${prim.label} revenue forgone`} value={fmtUsd(stats.byokForgone, 0)} sub="a month, at list price" />
            <Stat label={`${sec.label} on own keys`} value={fmtNum(byokActions)} sub="still billed" />
          </div>
          <PremiumSlider
            key={`byok-${pack.agents.byokFee}`}
            id="byok-fee"
            value={pack.agents.byokFee * 10000}
            min={0}
            max={20}
            step={1}
            format={(v) => `${fmtUsd(v / 10000, 4)} per ${sec.label.replace(/s$/, "").toLowerCase()}`}
            label="Platform fee on own-key steps"
            onCommit={(v) => run((s) => updatePack(s, (p) => { p.agents.byokFee = v / 10000; }, `Own-key platform fee ${fmtUsd(v / 10000, 4)}`), "Own-key platform fee updated.")}
          />
          <p className="text-sm">
            Recovers <span className="font-semibold tabular-nums">{fmtUsd(recovered, 0)}</span> a month across paid plans.
          </p>
        </section>
        )}
      </div>
    </div>
  );
}

// ---------------- MCP and agents ----------------

export function ControlsPanel({ t, stats, run }: { t: TenantState; stats: WorkbenchStats; run: WbRun }) {
  const pack = t.pack;
  const prim = primaryMeter(pack);
  const free = pack.plans.find((p) => !p.paid);
  const rows = Object.keys(pack.demo.population.profiles).map((id) => {
    const p = planOf(pack, id);
    const xs = stats.accounts.filter((a) => a.planId === id);
    const units = xs.reduce((s, a) => s + (stats.projections.get(a.id)?.usage[prim.id] ?? 0) * a.mcp, 0);
    const total = xs.reduce((s, a) => s + (stats.projections.get(a.id)?.usage[prim.id] ?? 0), 0);
    return { p, n: xs.length, heavy: xs.filter((a) => a.mcp >= pack.rules.mcpHeavyPct / 100).length, units, share: total ? units / total : 0 };
  });
  const saveNums = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const seatCap = Math.max(0, Number(f.get("seatCap")) || 0);
    const approvalOver = Math.max(0, Number(f.get("approvalOver")) || 0);
    run((s) => updatePack(s, (p) => { p.agents.seatCap = seatCap; p.agents.approvalOver = approvalOver; }, `Agent caps: ${fmtNum(seatCap)} per seat, approval over ${fmtNum(approvalOver)}`), "Agent guardrails saved.");
  };
  return (
    <div className="grid gap-6 xl:grid-cols-[380px_minmax(0,1fr)]">
      <section aria-labelledby="guard-title" className="space-y-3">
        <SectionTitle id="guard-title" aside="Read by every customer's Credits Hub">
          Guardrails
        </SectionTitle>
        <ul className="divide-y divide-border rounded-xl border border-border bg-card">
          <li className="flex items-center justify-between gap-3 px-4 py-3">
            <Label htmlFor="mcp-free" className="font-normal">MCP access on {free?.name ?? "free"}</Label>
            <Switch id="mcp-free" checked={pack.agents.mcpOnFree} onCheckedChange={(v) => run((s) => updatePack(s, (p) => { p.agents.mcpOnFree = v; }, `MCP on ${free?.name ?? "free"} ${v ? "on" : "off"}`), `MCP on ${free?.name ?? "free"} ${v ? "on" : "off"}.`)} />
          </li>
          <li className="flex items-center justify-between gap-3 px-4 py-3">
            <Label htmlFor="premium" className="font-normal">Premium data in agent runs</Label>
            <Switch id="premium" checked={pack.agents.premiumDataInAgents} onCheckedChange={(v) => run((s) => updatePack(s, (p) => { p.agents.premiumDataInAgents = v; }, `Premium data in agents ${v ? "on" : "off"}`), `Premium data in agents ${v ? "on" : "off"}.`)} />
          </li>
        </ul>
        <form key={`${pack.agents.seatCap}-${pack.agents.approvalOver}`} onSubmit={saveNums} className="space-y-3 rounded-xl border border-border bg-card p-4">
          <div className="space-y-1.5">
            <Label htmlFor="seatCap">Agent and MCP spend per seat ({prim.valueType === "currency" ? "USD" : prim.label} a cycle)</Label>
            <Input id="seatCap" name="seatCap" type="number" min={0} defaultValue={pack.agents.seatCap} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="approvalOver">Ask an admin for runs above ({prim.valueType === "currency" ? "USD" : prim.label})</Label>
            <Input id="approvalOver" name="approvalOver" type="number" min={0} defaultValue={pack.agents.approvalOver} />
          </div>
          <Button type="submit" size="sm">
            Save guardrails
          </Button>
        </form>
      </section>
      <section aria-labelledby="mcp-title" className="min-w-0 space-y-3">
        <SectionTitle id="mcp-title" aside="Runs started from ChatGPT, Claude and other MCP clients">
          MCP and agent usage
        </SectionTitle>
        <Table>
          <TableCaption className="sr-only">MCP usage by plan</TableCaption>
          <TableHeader>
            <TableRow>
              <TableHead scope="col">Plan</TableHead>
              <TableHead scope="col" className="text-right">Accounts</TableHead>
              <TableHead scope="col" className="text-right">MCP-first</TableHead>
              <TableHead scope="col" className="text-right">{prim.label} via MCP</TableHead>
              <TableHead scope="col" className="text-right">Share of plan usage</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.p.id}>
                <TableHead scope="row">
                  {r.p.name}
                  {!r.p.paid && !pack.agents.mcpOnFree ? <ToneBadge tone="neutral" className="ml-2">MCP off</ToneBadge> : null}
                </TableHead>
                <TableCell className="text-right tabular-nums">{fmtNum(r.n)}</TableCell>
                <TableCell className="text-right tabular-nums">{fmtNum(r.heavy)}</TableCell>
                <TableCell className="text-right tabular-nums">{fmtNum(r.units)}</TableCell>
                <TableCell className="text-right tabular-nums">{fmtPct(r.share)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </section>
    </div>
  );
}
