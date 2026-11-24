// Limits and governance (Phase 2 §2.6): spend and usage limits per member, table and
// workspace with warn or block, the role matrix, the approval queue, alert channels, the
// simulated notifications they send, and an audit view of who changed what.
import { useState, type FormEvent } from "react";
import { Check, Mail, MessageSquare, Bell, Plus, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { SectionTitle, UsageBar } from "@/ui/primitives";
import { ToneBadge } from "@/ui/tone";
import { useMoney } from "@/ui/money";
import { useConfirm } from "@/hooks/use-confirm";
import { useHub } from "@/surfaces/credits-hub/hub-context";
import { RequestCreditsDialog } from "@/surfaces/credits-hub/request-credits";
import {
  actorLabel,
  auditAreas,
  CAPABILITIES,
  cycleOf,
  decideRequest,
  fmtDate,
  fmtDateTime,
  limitsFor,
  limitTargetLabel,
  meterOf,
  primaryMeter,
  removeLimit,
  ROLE_LABEL,
  ROLE_MATRIX,
  setAlertSettings,
  setRole,
  tablesOf,
  upsertLimit,
  type SpendLimit,
  type TeamRole,
} from "@/core";

export function LimitsTab() {
  const { viewer } = useHub();
  if (viewer.role === "member") return <MemberLimits />;
  return (
    <div className="space-y-8">
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_400px]">
        <LimitsList />
        <ApprovalQueue />
      </div>
      <RoleMatrix />
      <div className="grid gap-6 xl:grid-cols-2">
        <AlertChannels />
        <Outbox />
      </div>
      <AuditView />
    </div>
  );
}

function useLimitRows() {
  const { t, account } = useHub();
  const hub = t.hub[account];
  const { start } = cycleOf(t);
  const tables = tablesOf(t, account);
  const tableName = (id: string) => tables.find((x) => x.id === id)?.name ?? id;
  return hub.limits.map((l) => {
    const who = l.scope === "member" ? { member: l.target, tableId: "", table: "" } : l.scope === "table" ? { member: "", tableId: l.target, table: tableName(l.target) } : { member: "", tableId: "", table: "" };
    const st = limitsFor({ ...hub, limits: [l] }, t.events, account, start, who)[0];
    return { l, label: limitTargetLabel(hub, l, tableName), spent: st?.spent ?? 0, pct: st?.pct ?? 0, state: st?.state ?? "ok" };
  });
}

function LimitsList() {
  const { t, account, viewer, run } = useHub();
  const { amountText } = useMoney();
  const confirm = useConfirm();
  const rows = useLimitRows();
  const [editing, setEditing] = useState<SpendLimit | "new" | null>(null);
  const canEdit = viewer.can("limits");
  return (
    <section aria-labelledby="limits-title" className="min-w-0 space-y-3">
      <SectionTitle
        id="limits-title"
        aside={
          canEdit && (
            <Button size="sm" variant="outline" onClick={() => setEditing("new")}>
              <Plus aria-hidden="true" />
              Add limit
            </Button>
          )
        }
      >
        Spend and usage limits
      </SectionTitle>
      <p className="type-caption text-muted-foreground">Per cycle. Warn sends an alert and lets the run continue; block pauses the run at the limit with nothing lost.</p>
      {rows.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border p-4 type-body text-muted-foreground">No limits yet. Add one per member, table or for the whole workspace.</p>
      ) : (
        <ul className="divide-y divide-border rounded-xl border border-border bg-card">
          {rows.map(({ l, label, spent, pct, state }) => {
            const m = meterOf(t.pack, l.meter);
            return (
              <li key={l.id} className="space-y-2 px-4 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="type-body font-medium">{label}</span>
                  <ToneBadge tone="neutral">{l.scope}</ToneBadge>
                  <ToneBadge tone={l.behaviour === "block" ? "watch" : "info"}>{l.behaviour === "block" ? "Blocks" : "Warns"}</ToneBadge>
                  {state === "block" && <ToneBadge tone="blocked">At limit</ToneBadge>}
                  {state === "warn" && <ToneBadge tone="watch">Over, warning sent</ToneBadge>}
                  {state === "near" && <ToneBadge tone="watch">Near</ToneBadge>}
                  <span className="ml-auto num type-body text-muted-foreground">
                    {amountText(m, spent, { label: false })} of {amountText(m, l.amount)}
                  </span>
                </div>
                <UsageBar value={spent} max={l.amount} label={`${label}: ${Math.round(pct * 100)}% of the limit`} />
                {canEdit && (
                  <div className="flex gap-2">
                    <Button size="sm" variant="ghost" onClick={() => setEditing(l)}>
                      Edit
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={async () => {
                        if (await confirm({ title: `Remove the ${label} limit?`, description: "Runs will no longer warn or pause at it. The change is in the audit log.", confirmLabel: "Remove limit" })) run((s) => removeLimit(s, account, l.id, viewer.actor, label).state, `${label} limit removed.`);
                      }}
                    >
                      <Trash2 aria-hidden="true" />
                      Remove
                    </Button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {editing && <LimitForm initial={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
    </section>
  );
}

function LimitForm({ initial, onClose }: { initial: SpendLimit | null; onClose: () => void }) {
  const { t, account, viewer, run } = useHub();
  const hub = t.hub[account];
  const tables = tablesOf(t, account);
  const [scope, setScope] = useState<SpendLimit["scope"]>(initial?.scope ?? "member");
  const [error, setError] = useState<string | null>(null);
  const targets = scope === "member" ? hub.team.map((m) => ({ id: m.id, label: m.name })) : scope === "table" ? tables.map((x) => ({ id: x.id, label: x.name })) : [{ id: "workspace", label: "Whole workspace" }];
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const amount = Number(f.get("amount"));
    if (!Number.isFinite(amount) || amount <= 0) return setError("Enter a limit above zero.");
    const target = String(f.get("target"));
    const l: SpendLimit = { id: initial?.id ?? `lim_${scope}_${target}_${String(f.get("meter"))}`, scope, target, meter: String(f.get("meter")), amount, behaviour: String(f.get("behaviour")) as "warn" | "block" };
    const label = targets.find((x) => x.id === target)?.label ?? target;
    run((s) => upsertLimit(s, account, l, viewer.actor, label).state, `${label}: ${amount.toLocaleString("en-US")} ${meterOf(t.pack, l.meter).label}, ${l.behaviour}.`);
    onClose();
  };
  return (
    <form onSubmit={submit} className="space-y-3 rounded-xl border border-primary/40 bg-card p-4" noValidate>
      <h3 className="type-body font-semibold">{initial ? "Edit limit" : "New limit"}</h3>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="lim-scope">Applies to</Label>
          <NativeSelect id="lim-scope" className="w-full" value={scope} onChange={(e) => setScope(e.target.value as SpendLimit["scope"])} disabled={!!initial}>
            <NativeSelectOption value="member">A member</NativeSelectOption>
            <NativeSelectOption value="table">A table</NativeSelectOption>
            <NativeSelectOption value="workspace">The workspace</NativeSelectOption>
          </NativeSelect>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="lim-target">Which</Label>
          <NativeSelect id="lim-target" name="target" className="w-full" defaultValue={initial?.target} disabled={!!initial}>
            {targets.map((x) => (
              <NativeSelectOption key={x.id} value={x.id}>
                {x.label}
              </NativeSelectOption>
            ))}
          </NativeSelect>
          {initial && <input type="hidden" name="target" value={initial.target} />}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="lim-meter">Meter</Label>
          <NativeSelect id="lim-meter" name="meter" className="w-full" defaultValue={initial?.meter ?? primaryMeter(t.pack).id}>
            {t.pack.meters.map((m) => (
              <NativeSelectOption key={m.id} value={m.id}>
                {m.label}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="lim-amount">Limit per cycle</Label>
          <Input id="lim-amount" name="amount" inputMode="decimal" defaultValue={initial?.amount ?? ""} aria-invalid={!!error} />
        </div>
      </div>
      <fieldset className="space-y-1.5">
        <legend className="type-body font-medium">At the limit</legend>
        <NativeSelect name="behaviour" aria-label="At the limit" className="w-full" defaultValue={initial?.behaviour ?? "warn"}>
          <NativeSelectOption value="warn">Warn: alert and let runs continue</NativeSelectOption>
          <NativeSelectOption value="block">Block: pause runs at the limit</NativeSelectOption>
        </NativeSelect>
      </fieldset>
      {error && (
        <p role="alert" className="type-caption text-blocked-ink">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <Button type="submit" size="sm">
          Save limit
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onClose}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

function ApprovalQueue() {
  const { t, account, viewer, act } = useHub();
  const { amountText, fmtUsd } = useMoney();
  const hub = t.hub[account];
  const pending = hub.requests.filter((r) => r.status === "pending");
  const done = hub.requests.filter((r) => r.status !== "pending").slice().reverse().slice(0, 6);
  const canApprove = viewer.can("approve");
  return (
    <section aria-labelledby="queue-title" className="space-y-3">
      <SectionTitle id="queue-title">Approval queue</SectionTitle>
      {pending.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border p-4 type-body text-muted-foreground">No requests waiting. When a Member asks for credits it lands here, in e-mail and in team chat.</p>
      ) : (
        <ul className="space-y-2">
          {pending.map((r) => {
            const m = meterOf(t.pack, r.meter);
            return (
              <li key={r.id} className="space-y-2 rounded-xl border border-border bg-card p-3">
                <div className="type-body">
                  <span className="font-medium">{r.fromName}</span> asks for {amountText(m, r.amount)} <span className="text-muted-foreground">· about {fmtUsd(r.usd)} · {fmtDate(r.ts)}</span>
                </div>
                <p className="type-caption text-muted-foreground">"{r.reason}"</p>
                {canApprove && (
                  <div className="flex gap-2">
                    <Button size="sm" onClick={() => act((s) => decideRequest(s, account, r.id, true, viewer.actor), (x) => ({ ok: x.ok, text: x.ok ? `Approved. ${x.note}` : x.note }))}>
                      <Check aria-hidden="true" />
                      Approve
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => act((s) => decideRequest(s, account, r.id, false, viewer.actor), (x) => ({ ok: x.ok, text: x.ok ? `${r.fromName}'s request declined.` : x.note }))}>
                      <X aria-hidden="true" />
                      Decline
                    </Button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {done.length > 0 && (
        <ul className="space-y-1 type-caption text-muted-foreground">
          {done.map((r) => (
            <li key={r.id}>
              {fmtDate(r.decidedAt ?? r.ts)} · {r.fromName} · {amountText(meterOf(t.pack, r.meter), r.amount)} · {r.status} by {actorLabel(hub, r.decidedBy ?? "")}
              {r.note ? ` · ${r.note}` : ""}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function RoleMatrix() {
  const { t, account, viewer, run } = useHub();
  const hub = t.hub[account];
  const canEdit = viewer.can("roles");
  const roles: TeamRole[] = ["admin", "billing", "member"];
  return (
    <section aria-labelledby="roles-title" className="space-y-3">
      <SectionTitle id="roles-title">Roles</SectionTitle>
      <div className="grid gap-6 xl:grid-cols-[360px_minmax(0,1fr)]">
        <ul className="divide-y divide-border rounded-xl border border-border bg-card">
          {hub.team.map((m) => (
            <li key={m.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
              <div className="min-w-0">
                <div className="type-body font-medium">{m.name}</div>
                <div className="type-caption text-muted-foreground">{m.title}</div>
              </div>
              {canEdit && !(m.id === viewer.id && m.role === "admin") ? (
                <NativeSelect size="sm" aria-label={`${m.name}'s role`} value={m.role} onChange={(e) => run((s) => setRole(s, account, m.id, e.target.value as TeamRole, viewer.actor).state, `${m.name} is now ${ROLE_LABEL[e.target.value as TeamRole]}.`)}>
                  {roles.map((r) => (
                    <NativeSelectOption key={r} value={r}>
                      {ROLE_LABEL[r]}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              ) : (
                <ToneBadge tone="neutral">{ROLE_LABEL[m.role]}</ToneBadge>
              )}
            </li>
          ))}
        </ul>
        <div className="overflow-x-auto rounded-xl border border-border">
          <Table>
            <TableCaption className="sr-only">What each role can do</TableCaption>
            <TableHeader>
              <TableRow>
                <TableHead>Can</TableHead>
                {roles.map((r) => (
                  <TableHead key={r} className="text-center">
                    {ROLE_LABEL[r]}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {CAPABILITIES.map((c) => (
                <TableRow key={c.id}>
                  <TableCell>
                    <div className="type-body">{c.label}</div>
                    <div className="type-caption text-muted-foreground">{c.detail}</div>
                  </TableCell>
                  {roles.map((r) => (
                    <TableCell key={r} className="text-center">
                      {ROLE_MATRIX[r].includes(c.id) ? <Check aria-label="Yes" className="mx-auto size-4 text-healthy-ink" /> : <span className="text-muted-foreground" aria-label="No">–</span>}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>
    </section>
  );
}

function AlertChannels() {
  const { t, account, viewer, run } = useHub();
  const hub = t.hub[account];
  const canEdit = viewer.can("limits");
  const ch = hub.alertChannels;
  const set = (patch: Partial<typeof ch>) => run((s) => setAlertSettings(s, account, { channels: { ...ch, ...patch } }, viewer.actor).state, "Alert channels saved.");
  const items: { id: keyof typeof ch; label: string; icon: typeof Mail; detail: string }[] = [
    { id: "email", label: "E-mail", icon: Mail, detail: `To ${hub.team.filter((m) => m.role !== "member").map((m) => m.name).join(", ")}` },
    { id: "chat", label: "Team chat", icon: MessageSquare, detail: "#revops-billing" },
    { id: "inapp", label: "In the Hub", icon: Bell, detail: "Moments on Home" },
  ];
  return (
    <section aria-labelledby="alerts-title" className="space-y-3">
      <SectionTitle id="alerts-title">Alert channels</SectionTitle>
      <ul className="divide-y divide-border rounded-xl border border-border bg-card">
        {items.map((x) => (
          <li key={x.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
            <div className="flex items-center gap-2.5">
              <x.icon aria-hidden="true" className="size-4 text-muted-foreground" />
              <div>
                <Label htmlFor={`ch-${x.id}`}>{x.label}</Label>
                <div className="type-caption text-muted-foreground">{x.detail}</div>
              </div>
            </div>
            <Switch id={`ch-${x.id}`} checked={ch[x.id]} disabled={!canEdit || x.id === "inapp"} onCheckedChange={(v) => set({ [x.id]: v })} />
          </li>
        ))}
      </ul>
      <fieldset className="space-y-2 rounded-xl border border-border bg-card p-4">
        <legend className="px-1 type-body font-medium">Usage alerts</legend>
        <div className="flex flex-wrap gap-4">
          {t.pack.hub.thresholds.map((p) => (
            <div key={p} className="flex items-center gap-2">
              <Switch id={`al-${p}`} checked={!!hub.alerts[String(p)]} disabled={!canEdit} onCheckedChange={(v) => run((s) => setAlertSettings(s, account, { alerts: { ...hub.alerts, [String(p)]: v } }, viewer.actor).state, `${p}% alert ${v ? "on" : "off"}.`)} />
              <Label htmlFor={`al-${p}`}>{p}%</Label>
            </div>
          ))}
        </div>
        <p className="type-caption text-muted-foreground">Of each meter's cycle allowance. A forecast warning also fires when the run-out date lands before the reset.</p>
      </fieldset>
    </section>
  );
}

function Outbox() {
  const { t, account } = useHub();
  const hub = t.hub[account];
  const items = hub.notices.slice().reverse().slice(0, 8);
  const icon = { email: Mail, chat: MessageSquare, inapp: Bell } as const;
  return (
    <section aria-labelledby="outbox-title" className="space-y-3">
      <SectionTitle id="outbox-title">Sent notifications</SectionTitle>
      {items.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border p-4 type-body text-muted-foreground">Nothing sent yet. Requests, approvals and alerts appear here exactly as they went out.</p>
      ) : (
        <ul className="space-y-2">
          {items.map((n) => {
            const I = icon[n.channel];
            return (
              <li key={n.id} className="rounded-xl border border-border bg-card p-3">
                <div className="flex items-center gap-2 type-caption text-muted-foreground">
                  <I aria-hidden="true" className="size-3.5" />
                  {n.channel === "email" ? "E-mail" : n.channel === "chat" ? "Team chat" : "In the Hub"} to {n.to} · {fmtDateTime(n.ts)}
                </div>
                <div className="type-body font-medium">{n.subject}</div>
                <p className="type-caption">{n.body}</p>
                {n.action && <span className="mt-1 inline-block rounded-md bg-primary px-2 py-0.5 type-caption text-primary-foreground">{n.action}</span>}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function AuditView() {
  const { t, account } = useHub();
  const hub = t.hub[account];
  const [area, setArea] = useState("all");
  const rows = hub.audit.filter((a) => area === "all" || a.area === area).slice().reverse();
  return (
    <section aria-labelledby="audit-title" className="space-y-3">
      <SectionTitle
        id="audit-title"
        aside={
          <NativeSelect size="sm" aria-label="Filter the audit log" value={area} onChange={(e) => setArea(e.target.value)}>
            <NativeSelectOption value="all">All changes</NativeSelectOption>
            {auditAreas.map((a) => (
              <NativeSelectOption key={a} value={a}>
                {a[0].toUpperCase() + a.slice(1)}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        }
      >
        Who changed what
      </SectionTitle>
      {rows.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border p-4 type-body text-muted-foreground">No changes {area === "all" ? "yet" : `to ${area} yet`}. Every limit, role, auto top-up, plan and billing change is recorded here with before and after.</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border">
          <Table>
            <TableCaption className="sr-only">Audit log, newest first</TableCaption>
            <TableHeader>
              <TableRow>
                <TableHead>When</TableHead>
                <TableHead>Who</TableHead>
                <TableHead>What</TableHead>
                <TableHead>Before</TableHead>
                <TableHead>After</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((a) => (
                <TableRow key={a.id}>
                  <TableCell className="whitespace-nowrap num">{fmtDateTime(a.ts)}</TableCell>
                  <TableCell>{actorLabel(hub, a.actor)}</TableCell>
                  <TableCell>
                    {a.what} <span className="type-caption text-muted-foreground">· {a.area}</span>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{a.from ?? "—"}</TableCell>
                  <TableCell>{a.to ?? "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </section>
  );
}

function MemberLimits() {
  const { t, account, viewer } = useHub();
  const { amountText } = useMoney();
  const [open, setOpen] = useState(false);
  const hub = t.hub[account];
  const rows = useLimitRows().filter((r) => r.l.scope === "workspace" || (r.l.scope === "member" && r.l.target === viewer.id) || r.l.scope === "table");
  const mine = hub.requests.filter((r) => r.from === viewer.id).slice().reverse();
  const prim = primaryMeter(t.pack);
  return (
    <div className="grid gap-6 xl:grid-cols-2">
      <section aria-labelledby="my-limits" className="space-y-3">
        <SectionTitle id="my-limits">Limits that apply to you</SectionTitle>
        {rows.length === 0 ? (
          <p className="type-body text-muted-foreground">No limits apply to your runs.</p>
        ) : (
          <ul className="divide-y divide-border rounded-xl border border-border bg-card">
            {rows.map(({ l, label, spent }) => (
              <li key={l.id} className="space-y-1.5 px-4 py-3">
                <div className="flex flex-wrap items-center gap-2 type-body">
                  <span className="font-medium">{l.scope === "member" ? "You" : label}</span>
                  <ToneBadge tone={l.behaviour === "block" ? "watch" : "info"}>{l.behaviour === "block" ? "Pauses runs" : "Warns"}</ToneBadge>
                  <span className="ml-auto num text-muted-foreground">
                    {amountText(meterOf(t.pack, l.meter), spent, { label: false })} of {amountText(meterOf(t.pack, l.meter), l.amount)}
                  </span>
                </div>
                <UsageBar value={spent} max={l.amount} label={`${label}: ${amountText(meterOf(t.pack, l.meter), spent)} of ${amountText(meterOf(t.pack, l.meter), l.amount)}`} />
              </li>
            ))}
          </ul>
        )}
        <p className="type-caption text-muted-foreground">Set by {hub.team.filter((m) => m.role === "admin").map((m) => m.name).join(", ")}. Ask for more and they can approve in one tap.</p>
        <Button size="sm" onClick={() => setOpen(true)}>
          Request credits
        </Button>
      </section>
      <section aria-labelledby="my-requests" className="space-y-3">
        <SectionTitle id="my-requests">Your requests</SectionTitle>
        {mine.length === 0 ? (
          <p className="type-body text-muted-foreground">You haven't asked for credits this cycle.</p>
        ) : (
          <ul className="space-y-2">
            {mine.map((r) => (
              <li key={r.id} className="rounded-xl border border-border bg-card p-3 type-body">
                <div className="flex items-center justify-between gap-2">
                  <span>{amountText(meterOf(t.pack, r.meter), r.amount)}</span>
                  <ToneBadge tone={r.status === "approved" ? "healthy" : r.status === "declined" ? "neutral" : "info"}>{r.status === "pending" ? "Waiting" : r.status === "approved" ? "Approved" : "Declined"}</ToneBadge>
                </div>
                <p className="type-caption text-muted-foreground">
                  {fmtDate(r.ts)} · "{r.reason}"{r.note ? ` · ${r.note}` : ""}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>
      {open && <RequestCreditsDialog open onOpenChange={setOpen} prefill={{ meter: prim.id, amount: 100, reason: "More credits to finish this week's tables." }} />}
    </div>
  );
}
