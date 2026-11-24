// Bring Your Own Evals (Phase 6): skill registry with a register wizard, bring your data, and the
// tabs for runs and results, model right-sizing, the quality gate and the regression watch.
import { useMemo, useState, type ChangeEvent } from "react";
import { CheckCircle2, CircleX, FlaskConical, KeyRound, PlugZap, Upload, Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Range } from "@/ui/range";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { SectionTitle, Stat, UsageBar } from "@/ui/primitives";
import { ToneBadge } from "@/ui/tone";
import { useConfirm } from "@/hooks/use-confirm";
import { fmtDate, fmtNum } from "@/core/format";
import { fnv1a } from "@/core/time";
import { usePlatform } from "@/surfaces/platform/use-platform";
import { useCockpit } from "@/lib/cockpit-store";
import { GateBadge, GatePanel, RegressionPanel, ResultsPanel, RightSizingPanel } from "@/surfaces/workbench/eval-results";
import { datasetWarnings, EXAMPLE_MANIFEST, gateFor, MCP_SERVER_SKILLS, modelName, monthUsed, parseCsv, preTestOk, sampleDataset, syntheticDataset, validateManifest, type Validation } from "@/platform/evals";
import { addDataset, deleteDataset, registerSkill, setMargin } from "@/platform/eval-actions";
import type { Dataset, SkillManifest } from "@/platform/types";

const EVAL_TABS = ["skills", "data", "results", "rightsizing", "gate", "regression"];

export function EvalsPanel() {
  const { t, run, setUi } = usePlatform();
  const ev = t.platform.evals;
  const sub = useCockpit((s) => s.wbSub);
  const [skillId, setSkillId] = useState(ev.skills.find((s) => s.id === "company-research")?.id ?? ev.skills[0]?.id ?? "");
  const [local, setLocal] = useState("rightsizing");
  const tab = sub && EVAL_TABS.includes(sub) ? sub : local;
  const setTab = (v: string) => {
    setLocal(v);
    if (sub) setUi({ wbSub: null });
  };
  const used = monthUsed(ev, t.clock);
  const live = ev.skills.filter((s) => s.status === "live");
  return (
    <div className="space-y-5">
      <div className="grid gap-4 rounded-xl border border-border bg-card p-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
        <div className="space-y-1.5">
          <Label htmlFor="eval-skill">Skill</Label>
          <NativeSelect id="eval-skill" value={skillId} onChange={(e) => setSkillId(e.target.value)}>
            {live.map((s) => (
              <NativeSelectOption key={s.id} value={s.id}>
                {s.manifest.name}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </div>
        <div className="space-y-1.5">
          <div className="flex items-center justify-between type-caption">
            <span className="font-medium">Eval credits this month</span>
            <span className="num text-muted-foreground">
              {fmtNum(used)} of {fmtNum(ev.budget.monthly)}
            </span>
          </div>
          <UsageBar value={used} max={ev.budget.monthly} label="Eval credits used this month" />
          <p className="type-caption text-muted-foreground">Every run is billed in eval credits so its cost is visible before it starts.</p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="eval-margin">Non-inferiority margin</Label>
          <NativeSelect id="eval-margin" value={String(ev.margin)} onChange={(e) => run((s) => setMargin(s, Number(e.target.value)), `Margin set to ${e.target.value} quality points.`)}>
            {[1, 1.5, 2, 3, 5].map((m) => (
              <NativeSelectOption key={m} value={String(m)}>
                {m} quality points
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </div>
      </div>
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList aria-label="Evals sections" className="w-full flex-nowrap justify-start overflow-x-auto">
          <TabsTrigger value="skills">Skills</TabsTrigger>
          <TabsTrigger value="data">Data</TabsTrigger>
          <TabsTrigger value="results">Runs and results</TabsTrigger>
          <TabsTrigger value="rightsizing">Model right-sizing</TabsTrigger>
          <TabsTrigger value="gate">Quality gate</TabsTrigger>
          <TabsTrigger value="regression">Regression watch</TabsTrigger>
        </TabsList>
        <TabsContent value="skills" className="pt-4">
          <SkillsPanel onOpen={(id) => { setSkillId(id); setTab("results"); }} />
        </TabsContent>
        <TabsContent value="data" className="pt-4">
          <DataPanel skillId={skillId} />
        </TabsContent>
        <TabsContent value="results" className="pt-4">
          <ResultsPanel skillId={skillId} />
        </TabsContent>
        <TabsContent value="rightsizing" className="pt-4">
          <RightSizingPanel skillId={skillId} />
        </TabsContent>
        <TabsContent value="gate" className="pt-4">
          <GatePanel />
        </TabsContent>
        <TabsContent value="regression" className="pt-4">
          <RegressionPanel skillId={skillId} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ------------------------------------------------------------------ skills and the register wizard

function SkillsPanel({ onOpen }: { onOpen: (id: string) => void }) {
  const { t } = usePlatform();
  const ev = t.platform.evals;
  const [wizard, setWizard] = useState(false);
  return (
    <div className="space-y-6">
      <section aria-labelledby="skills-h" className="space-y-3">
        <SectionTitle id="skills-h" aside={<Button size="sm" onClick={() => setWizard((w) => !w)}><PlugZap aria-hidden="true" />{wizard ? "Close the wizard" : "Register a skill"}</Button>}>
          Skill registry
        </SectionTitle>
        <p className="type-body text-muted-foreground">Each AI skill is described by a manifest served by an MCP server or an HTTP endpoint. Evals call skills read-only, inside an isolated test tenant.</p>
        <Table>
          <TableCaption className="sr-only">Registered skills with meter mapping, models and the gate state of the model in use</TableCaption>
          <TableHeader>
            <TableRow>
              <TableHead scope="col">Skill</TableHead>
              <TableHead scope="col">Endpoint</TableHead>
              <TableHead scope="col" className="text-right">Per call</TableHead>
              <TableHead scope="col">Model in use</TableHead>
              <TableHead scope="col">Gate</TableHead>
              <TableHead scope="col">Secret</TableHead>
              <TableHead scope="col"><span className="sr-only">Open</span></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {ev.skills.map((s) => {
              const g = s.status === "live" ? gateFor(ev, t.pack, s.id, s.inUse) : null;
              return (
                <TableRow key={s.id}>
                  <TableHead scope="row" className="min-w-44">
                    <div className="font-medium">{s.manifest.name}</div>
                    <div className="type-caption font-normal text-muted-foreground">{s.status === "draft" ? "Draft: finish registration" : `${s.manifest.allowedModels.length} allowed models`}</div>
                  </TableHead>
                  <TableCell className="max-w-56 truncate font-mono text-xs">{s.manifest.endpoint}</TableCell>
                  <TableCell className="text-right tabular-nums">{s.manifest.meter.dataCredits} DC · {s.manifest.meter.actions} act</TableCell>
                  <TableCell>{modelName(s.inUse)}</TableCell>
                  <TableCell>{g ? <GateBadge state={g.state} /> : <ToneBadge tone="neutral">Draft</ToneBadge>}</TableCell>
                  <TableCell className="font-mono text-xs">{s.vault ? `•••• ${s.vault.fingerprint.slice(0, 4)}` : "—"}</TableCell>
                  <TableCell>
                    {s.status === "live" && (
                      <Button size="xs" variant="ghost" onClick={() => onOpen(s.id)} aria-label={`Open results for ${s.manifest.name}`}>
                        Results
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </section>
      {wizard && <RegisterWizard onDone={() => setWizard(false)} />}
    </div>
  );
}

function Checklist({ v }: { v: Validation }) {
  return (
    <ul aria-label="Validation checklist" className="divide-y divide-border rounded-lg border border-border">
      {v.checks.map((c) => (
        <li key={c.id} className="flex items-start gap-2 px-3 py-2 type-caption">
          {c.ok ? <CheckCircle2 aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-healthy" /> : <CircleX aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-blocked" />}
          <span className="min-w-0 flex-1">
            <span className="font-medium">{c.label}</span>
            <span className="sr-only">{c.ok ? " passed" : " failed"}</span>
            <span className="block text-muted-foreground">{c.detail}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

function RegisterWizard({ onDone }: { onDone: () => void }) {
  const { act, who } = usePlatform();
  const [source, setSource] = useState<"url" | "mcp">("url");
  const [url, setUrl] = useState("https://skills.tenant.example/v1/lead_intent/manifest.json");
  const [server, setServer] = useState("mcp://skills.tenant.example");
  const [listed, setListed] = useState<SkillManifest[] | null>(null);
  const [text, setText] = useState("");
  const [secret, setSecret] = useState("");
  const [vault, setVault] = useState<string | null>(null);
  const [tested, setTested] = useState(false);
  const [validated, setValidated] = useState<Validation | null>(null);
  const [sample, setSample] = useState<string | null>(null);
  const load = (m: SkillManifest) => {
    setText(JSON.stringify(m, null, 2));
    setValidated(null);
    setTested(false);
    setSample(null);
  };
  const validate = () => {
    const v = validateManifest(text, !!vault, tested);
    setValidated(v);
    return v;
  };
  const fix = (patch: Partial<SkillManifest>) => {
    try {
      const m = { ...(JSON.parse(text) as SkillManifest), ...patch };
      setText(JSON.stringify(m, null, 2));
      setValidated(validateManifest(m, !!vault, false));
      setTested(false);
    } catch {
      /* the checklist already says the JSON is invalid */
    }
  };
  const store = () => {
    if (secret.length < 8) return;
    setVault(fnv1a(`vault|${secret}`).slice(0, 8));
    setSecret("");
    if (validated) setValidated(validateManifest(text, true, tested));
  };
  const test = () => {
    const v = validateManifest(text, !!vault, false);
    if (!preTestOk(v) || !v.manifest) {
      setValidated(v);
      return;
    }
    const out = Object.fromEntries(Object.entries(v.manifest.output).map(([k, ty]) => [k, ty.startsWith("number") ? 0.82 : ty.startsWith("enum") ? ty.slice(5, -1).split(",")[0] : ty.endsWith("[]") ? ["…"] : "…"]));
    setSample(JSON.stringify(out, null, 2));
    setTested(true);
    setValidated(validateManifest(text, true, true));
  };
  const register = () => {
    const v = validateManifest(text, !!vault, tested);
    setValidated(v);
    if (!v.ok || !v.manifest || !vault) return;
    const r = act((s) => registerSkill(s, v.manifest!, vault, who));
    if (r?.ok) onDone();
  };
  const v = validated;
  return (
    <section aria-labelledby="wiz-h" className="space-y-4 rounded-xl border border-border bg-card p-5">
      <h3 id="wiz-h" className="type-heading">Register a skill</h3>
      <ol className="grid gap-5 lg:grid-cols-2">
        <li className="space-y-3">
          <div className="type-body font-semibold">1. Where the skill lives</div>
          <div role="radiogroup" aria-label="Skill source" className="inline-flex rounded-md border border-border p-0.5">
            {(["url", "mcp"] as const).map((x) => (
              <button key={x} type="button" role="radio" aria-checked={source === x} onClick={() => setSource(x)} className={`rounded px-3 py-1 type-caption font-medium focus-visible:outline-2 focus-visible:outline-ring ${source === x ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}>
                {x === "url" ? "Manifest URL" : "MCP server"}
              </button>
            ))}
          </div>
          {source === "url" ? (
            <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); load(EXAMPLE_MANIFEST); }}>
              <Label htmlFor="man-url" className="sr-only">Manifest URL</Label>
              <Input id="man-url" value={url} onChange={(e) => setUrl(e.target.value)} />
              <Button type="submit" variant="outline">Fetch</Button>
            </form>
          ) : (
            <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); setListed(MCP_SERVER_SKILLS); }}>
              <Label htmlFor="mcp-url" className="sr-only">MCP server address</Label>
              <Input id="mcp-url" value={server} onChange={(e) => setServer(e.target.value)} />
              <Button type="submit" variant="outline">Connect</Button>
            </form>
          )}
          {source === "mcp" && listed && (
            <ul aria-label="Tools the server lists" className="space-y-1">
              {listed.map((m) => (
                <li key={m.id}>
                  <Button size="sm" variant="ghost" onClick={() => load(m)}>
                    <Wand2 aria-hidden="true" />
                    {m.name}
                  </Button>
                </li>
              ))}
            </ul>
          )}
          <p className="type-caption text-muted-foreground">Simulated: the fetch and the connection return an example manifest, no network call is made.</p>
          <div className="space-y-1.5">
            <Label htmlFor="man-json">2. Manifest</Label>
            <Textarea id="man-json" value={text} onChange={(e) => { setText(e.target.value); setTested(false); }} rows={14} className="font-mono text-xs" placeholder="Fetch a manifest or paste one here" />
          </div>
          <Button onClick={validate} disabled={!text.trim()}>
            Validate
          </Button>
        </li>
        <li className="space-y-3">
          <div className="type-body font-semibold">3. Checks</div>
          {v ? <Checklist v={v} /> : <p className="type-body text-muted-foreground">Validate to see the checklist.</p>}
          {v && v.fixes.length > 0 && (
            <div className="space-y-1">
              <div className="type-caption font-medium">Fixes</div>
              {v.fixes.map((f) => (
                <Button key={f.check} size="sm" variant="outline" className="mr-2" onClick={() => fix(f.patch)}>
                  {f.label}
                </Button>
              ))}
            </div>
          )}
          <form className="space-y-1.5" onSubmit={(e) => { e.preventDefault(); store(); }}>
            <Label htmlFor="secret">4. API key or token</Label>
            <div className="flex gap-2">
              <Input id="secret" type="password" autoComplete="off" value={secret} onChange={(e) => setSecret(e.target.value)} placeholder={vault ? "Stored in the vault" : "Paste the key"} />
              <Button type="submit" variant="outline" disabled={secret.length < 8}>
                <KeyRound aria-hidden="true" />
                Store
              </Button>
            </div>
            <p className="type-caption text-muted-foreground">{vault ? `Stored in the vault. Only the fingerprint ${vault} is kept here; the key is never shown again.` : "The key goes straight to the vault (simulated) and is never displayed or logged."}</p>
          </form>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={test} disabled={!text.trim() || !vault}>
              5. Run a test call
            </Button>
            <Button onClick={register} disabled={!v?.ok}>
              Register
            </Button>
          </div>
          {sample && <pre aria-label="Test call output" className="max-h-40 overflow-auto rounded-md bg-muted p-2 font-mono text-xs">{sample}</pre>}
        </li>
      </ol>
    </section>
  );
}

// ------------------------------------------------------------------ bring your data

function DataPanel({ skillId }: { skillId: string }) {
  const { t, act, who } = usePlatform();
  const confirm = useConfirm();
  const ev = t.platform.evals;
  const skill = ev.skills.find((s) => s.id === skillId);
  const regions = t.pack.regions.length ? t.pack.regions : [{ id: "us", name: "United States", residency: "" }];
  const [mode, setMode] = useState<"upload" | "sample" | "synthetic">("upload");
  const [region, setRegion] = useState(regions[0].id);
  const [retention, setRetention] = useState(30);
  const [rows, setRows] = useState(240);
  const [desc, setDesc] = useState("Company websites, 30% non-English, 10% with cookie walls");
  const [mix, setMix] = useState(20);
  const [csv, setCsv] = useState<ReturnType<typeof parseCsv> & { name: string } | null>(null);
  const [golden, setGolden] = useState(true);
  const list = useMemo(() => ev.datasets.filter((d) => d.skillId === skillId), [ev.datasets, skillId]);
  if (!skill) return null;
  const onFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const text = await f.text();
    const p = parseCsv(text);
    setCsv({ ...p, name: f.name.replace(/\.csv$/i, "") });
    setGolden(p.golden);
  };
  const draft: Dataset | null =
    mode === "upload"
      ? csv && !csv.error
        ? { id: `ds-${fnv1a(`${csv.name}|${t.clock}|${csv.rows}`).slice(0, 6)}`, skillId, name: csv.name, source: "upload", rows: csv.rows, columns: csv.columns, golden, region, retentionDays: retention, createdAt: t.clock, masked: csv.masked, description: "Uploaded and anonymised in the browser. Only the row count, header and three masked rows are kept.", preview: csv.preview }
        : null
      : mode === "sample"
        ? { ...sampleDataset(t.pack, skill, rows, t.clock, region), retentionDays: retention }
        : { ...syntheticDataset(skill, rows, desc, mix, t.clock, region), retentionDays: retention };
  const warn = draft ? datasetWarnings(draft, skillId) : [];
  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_420px]">
      <section aria-labelledby="ds-h" className="min-w-0 space-y-3">
        <SectionTitle id="ds-h" aside={`${list.length} for ${skill.manifest.name}`}>
          Datasets
        </SectionTitle>
        {list.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border p-6 type-body text-muted-foreground">No datasets for this skill yet. Add one on the right.</p>
        ) : (
          <ul className="space-y-3">
            {list.map((d) => {
              const w = datasetWarnings(d, skillId);
              return (
                <li key={d.id} className="space-y-2 rounded-xl border border-border bg-card p-4">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <div className="type-body font-semibold">{d.name}</div>
                      <div className="type-caption text-muted-foreground">
                        {fmtNum(d.rows)} rows · {d.source === "upload" ? "uploaded" : d.source === "sample" ? "sampled from tenant data" : "synthetic"} · {d.golden ? "golden labels" : "no golden labels"}
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <ToneBadge tone="info">Region {d.region.toUpperCase()}</ToneBadge>
                      <ToneBadge tone="neutral">Kept {d.retentionDays} days · until {fmtDate(new Date(new Date(d.createdAt).getTime() + d.retentionDays * 86_400_000).toISOString())}</ToneBadge>
                      <Button
                        size="xs"
                        variant="outline"
                        onClick={async () => {
                          if (await confirm({ title: `Delete "${d.name}"?`, description: "The rows are removed now. Runs that used it keep their scores. This is recorded in the deletion log.", confirmLabel: "Delete dataset", destructive: true })) act((s) => deleteDataset(s, d.id, who));
                        }}
                      >
                        Delete dataset
                      </Button>
                    </div>
                  </div>
                  <p className="type-caption text-muted-foreground">{d.description}</p>
                  {d.masked.length > 0 && <p className="type-caption">Masked on the way in: {d.masked.join(", ")}</p>}
                  {w.map((x) => (
                    <p key={x} role="note" className="rounded-md bg-watch-soft px-2 py-1 type-caption text-watch-ink">
                      {x}
                    </p>
                  ))}
                </li>
              );
            })}
          </ul>
        )}
      </section>
      <section aria-labelledby="ds-add" className="space-y-3 rounded-xl border border-border bg-card p-4">
        <h3 id="ds-add" className="type-heading">Bring data</h3>
        <div role="radiogroup" aria-label="How to bring data" className="grid grid-cols-3 gap-1 rounded-md border border-border p-0.5">
          {([["upload", "Upload CSV"], ["sample", "Sample tenant data"], ["synthetic", "Generate synthetic"]] as const).map(([id, label]) => (
            <button key={id} type="button" role="radio" aria-checked={mode === id} onClick={() => setMode(id)} className={`rounded px-2 py-1 type-caption font-medium focus-visible:outline-2 focus-visible:outline-ring ${mode === id ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}>
              {label}
            </button>
          ))}
        </div>
        {mode === "upload" && (
          <div className="space-y-2">
            <Label htmlFor="csv">Anonymised CSV</Label>
            <Input id="csv" type="file" accept=".csv,text/csv" onChange={onFile} />
            {csv?.error && <p role="alert" className="type-caption text-blocked-ink">{csv.error}</p>}
            {csv && !csv.error && (
              <div className="space-y-1 type-caption">
                <p>
                  {fmtNum(csv.rows)} rows · columns {csv.columns.join(", ")}
                </p>
                {csv.masked.length > 0 && <p>Masked: {csv.masked.join(", ")}</p>}
                <div className="flex items-center gap-2">
                  <Switch id="golden" checked={golden} onCheckedChange={setGolden} />
                  <Label htmlFor="golden" className="font-normal">Has golden labels</Label>
                </div>
              </div>
            )}
            <p className="type-caption text-muted-foreground">
              <Upload aria-hidden="true" className="mr-1 inline size-3" />
              Parsed in the browser. Personal columns (names, emails, phones) are masked before anything is kept.
            </p>
          </div>
        )}
        {mode !== "upload" && (
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label htmlFor="ds-rows">Rows</Label>
              <span className="num type-caption">{fmtNum(rows)}</span>
            </div>
            <Range id="ds-rows" min={20} max={1000} step={10} value={rows} onValueChange={(x) => setRows(x)} aria-label="Rows" />
          </div>
        )}
        {mode === "synthetic" && (
          <>
            <div className="space-y-1.5">
              <Label htmlFor="ds-desc">Describe the distribution</Label>
              <Textarea id="ds-desc" rows={2} value={desc} onChange={(e) => setDesc(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label htmlFor="ds-mix">Edge cases</Label>
                <span className="num type-caption">{mix}%</span>
              </div>
              <Range id="ds-mix" min={0} max={60} step={5} value={mix} onValueChange={(x) => setMix(x)} aria-label="Edge cases" />
            </div>
          </>
        )}
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="ds-region">Region</Label>
            <NativeSelect id="ds-region" value={region} onChange={(e) => setRegion(e.target.value)}>
              {regions.map((r) => (
                <NativeSelectOption key={r.id} value={r.id}>
                  {r.name}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ds-ret">Retention</Label>
            <NativeSelect id="ds-ret" value={String(retention)} onChange={(e) => setRetention(Number(e.target.value))}>
              {[7, 30, 90].map((d) => (
                <NativeSelectOption key={d} value={String(d)}>
                  {d} days
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </div>
        </div>
        {warn.map((x) => (
          <p key={x} role="note" className="rounded-md bg-watch-soft px-2 py-1 type-caption text-watch-ink">
            {x}
          </p>
        ))}
        <Button className="w-full" disabled={!draft} onClick={() => draft && act((s) => addDataset(s, draft, who))}>
          <FlaskConical aria-hidden="true" />
          Add dataset
        </Button>
      </section>
    </div>
  );
}

export function EvalStats() {
  const { t } = usePlatform();
  const ev = t.platform.evals;
  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
      <Stat label="Skills" value={fmtNum(ev.skills.filter((s) => s.status === "live").length)} />
      <Stat label="Datasets" value={fmtNum(ev.datasets.length)} />
      <Stat label="Eval runs" value={fmtNum(ev.runs.length)} />
      <Stat label="Open alerts" value={fmtNum(ev.alerts.filter((a) => !a.routed).length)} />
    </div>
  );
}
