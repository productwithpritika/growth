// Trust and security (Phase 8 §8.5): tenant isolation and prompt-injection tests that run the real
// code paths, PII masking, the consent ledger, retention and deletion for datasets and Memory
// cards, region labels, audit export and least-privilege roles.
import { useMemo, useState } from "react";
import { CheckCircle2, CircleX, Download, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { SectionTitle } from "@/ui/primitives";
import { ToneBadge } from "@/ui/tone";
import { useConfirm } from "@/hooks/use-confirm";
import { fmtDate, fmtNum } from "@/core/format";
import { REGIONS } from "@/tenants/regions";
import { forgetCard } from "@/growth/state";
import type { TenantState } from "@/core/types";
import { usePlatform } from "@/surfaces/platform/use-platform";
import { auditExport, consentLedger, injectionTests, isolationTests, roleMatrix, type TestResult } from "@/platform/security";
import { maskPII } from "@/platform/privacy";
import { deleteDataset, expiringDatasets } from "@/platform/eval-actions";

function Results({ list, label }: { list: TestResult[]; label: string }) {
  const passed = list.filter((r) => r.pass).length;
  return (
    <div className="space-y-2">
      <p role="status" className={`type-body font-semibold ${passed === list.length ? "text-healthy-ink" : "text-blocked-ink"}`}>
        {passed} of {list.length} {label} passed
      </p>
      <ul className="space-y-1.5">
        {list.map((r) => (
          <li key={r.id} className="flex gap-2 type-caption">
            {r.pass ? <CheckCircle2 aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-healthy" /> : <CircleX aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-blocked" />}
            <span>
              <span className="font-medium">{r.label}</span>
              <span className="sr-only">{r.pass ? " passed" : " failed"}</span>
              <span className="block text-muted-foreground">{r.evidence}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function TrustPage() {
  const { t, act, run, who } = usePlatform();
  const confirm = useConfirm();
  const [iso, setIso] = useState<TestResult[] | null>(null);
  const [inj, setInj] = useState<TestResult[] | null>(null);
  const [sample, setSample] = useState("Refund jane.doe@northwind.example on card 4242 4242 4242 4242, call +1 415 555 0199. Paste a token to see it masked too.");
  const consents = useMemo(() => consentLedger(t), [t]);
  const datasets = expiringDatasets(t);
  const cards = t.growth.memory.filter((m) => !m.forgotten);
  const roles = roleMatrix();
  const download = () => {
    const blob = new Blob([auditExport(t)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${t.packId}-audit-${t.clock.slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("Audit export downloaded (masked).");
  };
  return (
    <div className="mx-auto max-w-[1440px] space-y-8 px-4 py-5 sm:px-6 sm:py-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="type-title">Trust and security · {t.pack.company}</h1>
          <p className="type-body text-muted-foreground">Help-chat text, dataset contents and tool outputs are treated as data, never as instructions. The tests below run the real code.</p>
        </div>
        <Button variant="outline" onClick={download}>
          <Download aria-hidden="true" />
          Export the audit log
        </Button>
      </div>
      <div className="grid gap-6 xl:grid-cols-2">
        <section aria-labelledby="iso-h" className="min-w-0 space-y-3 rounded-xl border border-border bg-card p-4">
          <SectionTitle id="iso-h" as="h2" aside={<Button size="sm" onClick={() => setIso(isolationTests(t, REGIONS))}><ShieldCheck aria-hidden="true" />Run isolation tests</Button>}>
            Tenant isolation
          </SectionTitle>
          {iso ? <Results list={iso} label="isolation tests" /> : <p className="type-body text-muted-foreground">Cross-tenant tokens, account scopes, the ledger, eval sandboxes, the end-user assistant and log masking.</p>}
        </section>
        <section aria-labelledby="inj-h" className="min-w-0 space-y-3 rounded-xl border border-border bg-card p-4">
          <SectionTitle id="inj-h" as="h2" aside={<Button size="sm" onClick={() => setInj(injectionTests(t, REGIONS))}><ShieldCheck aria-hidden="true" />Run injection tests</Button>}>
            Prompt injection
          </SectionTitle>
          {inj ? <Results list={inj} label="injection tests" /> : <p className="type-body text-muted-foreground">Six attacks through help chats, pasted text, dataset rows, tool outputs, a Moment prompt and a CSV. None may cause a write.</p>}
        </section>
      </div>
      <section aria-labelledby="pii-h" className="grid gap-4 rounded-xl border border-border bg-card p-4 lg:grid-cols-2">
        <div className="min-w-0 space-y-2">
          <h2 id="pii-h" className="type-heading">PII masking in logs and prompts</h2>
          <Label htmlFor="pii-in">Text as typed</Label>
          <Textarea id="pii-in" rows={3} value={sample} onChange={(e) => setSample(e.target.value)} />
          <div className="type-caption font-medium">As logged and sent to a model</div>
          <p aria-live="polite" className="rounded-md bg-muted p-2 font-mono text-xs break-words">{maskPII(sample)}</p>
        </div>
        <div className="min-w-0 space-y-2">
          <div className="type-caption font-medium">Latest MCP log entries (masked at write)</div>
          <ul className="space-y-1 font-mono text-xs">
            {t.platform.mcp.activity.slice(0, 6).map((a) => (
              <li key={a.id} className="truncate">
                {a.tool} {JSON.stringify(a.args)}
              </li>
            ))}
            {t.platform.mcp.activity.length === 0 && <li className="font-sans text-muted-foreground">No calls yet.</li>}
          </ul>
        </div>
      </section>
      <section aria-labelledby="ret-h" className="space-y-3">
        <SectionTitle id="ret-h" aside="Retention and deletion for datasets and Memory cards">
          Retention
        </SectionTitle>
        <div className="grid gap-6 xl:grid-cols-2">
          <Table>
            <TableCaption>Eval datasets</TableCaption>
            <TableHeader>
              <TableRow>
                <TableHead scope="col">Dataset</TableHead>
                <TableHead scope="col">Region</TableHead>
                <TableHead scope="col">Deleted on</TableHead>
                <TableHead scope="col"><span className="sr-only">Delete</span></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {datasets.map(({ ds, expiresAt, daysLeft }) => (
                <TableRow key={ds.id}>
                  <TableHead scope="row">
                    {ds.name}
                    <span className="block type-caption font-normal text-muted-foreground">{fmtNum(ds.rows)} rows · kept {ds.retentionDays} days</span>
                  </TableHead>
                  <TableCell>
                    <ToneBadge tone="info">{ds.region.toUpperCase()}</ToneBadge>
                  </TableCell>
                  <TableCell>
                    {fmtDate(expiresAt)} <span className="type-caption text-muted-foreground">({daysLeft} days)</span>
                  </TableCell>
                  <TableCell>
                    <Button size="xs" variant="outline" onClick={async () => { if (await confirm({ title: `Delete "${ds.name}" now?`, description: "Recorded in the deletion log.", confirmLabel: "Delete", destructive: true })) act((s) => deleteDataset(s, ds.id, who, "Deleted from Trust and security")); }}>
                      Delete now
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <div className="min-w-0 space-y-3">
            <Table>
              <TableCaption>Memory cards</TableCaption>
              <TableHeader>
                <TableRow>
                  <TableHead scope="col">Card</TableHead>
                  <TableHead scope="col">Updated</TableHead>
                  <TableHead scope="col"><span className="sr-only">Forget</span></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {cards.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={3} className="type-caption text-muted-foreground">No Memory cards yet: they appear after onboarding.</TableCell>
                  </TableRow>
                )}
                {cards.slice(0, 8).map((c) => (
                  <TableRow key={c.id}>
                    <TableHead scope="row">{c.title}</TableHead>
                    <TableCell>{fmtDate(c.updatedAt)}</TableCell>
                    <TableCell>
                      <Button size="xs" variant="outline" onClick={() => run((s) => ({ ...forgetCardIn(s, c.id, who), platform: { ...s.platform, deletions: [{ ts: s.clock, what: `Memory card "${c.title}"`, by: who }, ...s.platform.deletions] } }), "Forgotten. Ask CB no longer uses it.")}>
                        Forget
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <div className="space-y-1">
              <div className="type-caption font-medium">Deletion log</div>
              <ul className="space-y-0.5 type-caption text-muted-foreground">
                {t.platform.deletions.slice(0, 6).map((d, i) => (
                  <li key={i}>
                    {fmtDate(d.ts)} · {d.what} · {d.by}
                  </li>
                ))}
                {t.platform.deletions.length === 0 && <li>Nothing deleted yet.</li>}
              </ul>
            </div>
          </div>
        </div>
      </section>
      <div className="grid gap-6 xl:grid-cols-2">
        <section aria-labelledby="con-h" className="min-w-0 space-y-3">
          <SectionTitle id="con-h">Consent ledger</SectionTitle>
          <Table>
            <TableCaption className="sr-only">Consents on record</TableCaption>
            <TableHeader>
              <TableRow>
                <TableHead scope="col">Who</TableHead>
                <TableHead scope="col">Purpose</TableHead>
                <TableHead scope="col">Scope</TableHead>
                <TableHead scope="col">Region</TableHead>
                <TableHead scope="col">Given</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {consents.map((c, i) => (
                <TableRow key={i}>
                  <TableHead scope="row">{c.subject}</TableHead>
                  <TableCell className="whitespace-normal">{c.purpose}</TableCell>
                  <TableCell className="whitespace-normal type-caption">{c.scope}</TableCell>
                  <TableCell>{c.region.toUpperCase()}</TableCell>
                  <TableCell>{c.at ? fmtDate(c.at) : "Default"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </section>
        <section aria-labelledby="roles-h" className="min-w-0 space-y-3">
          <SectionTitle id="roles-h">Least-privilege roles</SectionTitle>
          <Table>
            <TableCaption className="sr-only">Roles, tiers and what each can do</TableCaption>
            <TableHeader>
              <TableRow>
                <TableHead scope="col">Role</TableHead>
                <TableHead scope="col">Tier</TableHead>
                <TableHead scope="col">Writes</TableHead>
                <TableHead scope="col" className="text-right">Tools</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {roles.map((r) => (
                <TableRow key={r.role}>
                  <TableHead scope="row" className="capitalize">
                    {r.role}
                    <span className="block type-caption font-normal normal-case text-muted-foreground">{r.who}</span>
                  </TableHead>
                  <TableCell>{r.label}</TableCell>
                  <TableCell>{r.write}</TableCell>
                  <TableCell className="text-right tabular-nums">{r.tools}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <div className="space-y-1 rounded-xl border border-border bg-card p-3 type-caption">
            <div className="font-medium">Region labels</div>
            {t.pack.regions.map((r) => (
              <div key={r.id}>
                {r.name} ({r.id.toUpperCase()}): {r.residency}
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}

function forgetCardIn(s: TenantState, id: string, by: string): TenantState {
  return { ...s, growth: forgetCard(s.growth, id, true, by, s.clock) };
}
