// Brain → Checks: the Phase 1 acceptance suites run live in the browser. The same suites run
// under `bun test tests/` (tests/acceptance.test.ts).
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { CheckCircle2, Play, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { SectionTitle } from "@/ui/primitives";
import { ToneBadge } from "@/ui/tone";
import { acceptanceSuites, runSuite, type SuiteResult } from "@/core/checks";
import { TENANT_PACKS } from "@/tenants/registry";
import { REGIONS } from "@/tenants/regions";
import type { TenantState } from "@/core";
import { GALLERY_STATES, GALLERY_STATE_COUNT } from "@/surfaces/gallery/coverage";

export function ChecksTab({ t }: { t: TenantState }) {
  const [results, setResults] = useState<SuiteResult[]>([]);
  const [running, setRunning] = useState<string | null>(null);
  const runAll = useCallback(() => {
    const suites = acceptanceSuites(TENANT_PACKS, REGIONS, t.clock);
    setResults([]);
    let i = 0;
    const next = () => {
      if (i >= suites.length) {
        setRunning(null);
        return;
      }
      setRunning(suites[i].title);
      window.setTimeout(() => {
        const r = runSuite(suites[i]);
        setResults((xs) => [...xs, r]);
        i++;
        next();
      }, 20);
    };
    next();
  }, [t.clock]);
  useEffect(() => {
    const id = window.setTimeout(runAll, 50);
    return () => window.clearTimeout(id);
  }, [runAll]);

  const passed = results.reduce((s, r) => s + r.passed, 0);
  const failed = results.reduce((s, r) => s + r.failed, 0);
  const gallery = Object.entries(GALLERY_STATES);
  return (
    <section aria-labelledby="checks-title" className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <SectionTitle id="checks-title" aside={running ? `Running ${running}…` : results.length ? `${passed} passed · ${failed} failed` : undefined}>
          Acceptance checks
        </SectionTitle>
        <Button size="sm" variant="outline" className="ml-auto" disabled={!!running} onClick={runAll}>
          <Play aria-hidden="true" />
          Run again
        </Button>
      </div>
      <p className="type-body text-muted-foreground">
        Pure functions checked against the built-in packs ({TENANT_PACKS.map((p) => p.company).join(", ")}) and region packs. The same suites run under the test runner with <span className="font-mono">bun test tests/</span>.
      </p>
      <p role="status" className="sr-only">
        {running ? `Running ${running}` : results.length ? `${passed} checks passed, ${failed} failed` : ""}
      </p>
      <div className="rounded-xl border border-border bg-card p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="type-body font-semibold">Gallery renders every component in all states</h3>
          <ToneBadge tone="healthy">
            {gallery.length} components · {GALLERY_STATE_COUNT} states
          </ToneBadge>
        </div>
        <p className="mt-1 type-caption text-muted-foreground">{gallery.map(([n, s]) => `${n} ${s.length}`).join(" · ")}</p>
        <Link to="/gallery" className="mt-2 inline-block type-caption font-medium underline underline-offset-2">
          Open the gallery
        </Link>
      </div>
      {results.map((r) => (
        <div key={r.id} className="space-y-2">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="type-body font-semibold">
              {r.title} <span className="font-normal text-muted-foreground">· {r.covers}</span>
            </h3>
            <ToneBadge tone={r.failed ? "blocked" : "healthy"}>
              {r.passed}/{r.results.length} · {r.ms} ms
            </ToneBadge>
          </div>
          <Table>
            <TableCaption className="sr-only">{r.title} results</TableCaption>
            <TableHeader>
              <TableRow>
                <TableHead scope="col" className="w-8">
                  <span className="sr-only">Result</span>
                </TableHead>
                <TableHead scope="col">Check</TableHead>
                <TableHead scope="col">What it found</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {r.results.map((c) => (
                <TableRow key={c.id}>
                  <TableCell>
                    {c.ok ? <CheckCircle2 aria-label="Passed" className="size-4 text-healthy-ink" /> : <XCircle aria-label="Failed" className="size-4 text-blocked-ink" />}
                  </TableCell>
                  <TableHead scope="row" className="font-normal whitespace-normal">
                    {c.name}
                  </TableHead>
                  <TableCell className="whitespace-normal type-caption text-muted-foreground">{c.detail}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ))}
    </section>
  );
}
