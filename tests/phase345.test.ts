// Phases 3–5 acceptance checks as pure, tested functions: `bun test tests/`.
// Phase 3: agentic onboarding and the tour. Phase 4: Ask CB. Phase 5: the Growth Workbench loop.
// The UI journeys that exercise the same rules end to end are in tests/journeys/phase345.journeys.mjs.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parsePack, type TenantPack } from "@/tenants/schema";
import { parseRegion, type RegionPack } from "@/tenants/region-schema";
import { seedTenant, advanceDay } from "@/sim/seed";
import type { TenantState } from "@/core/types";
import { answerQuestion, chargebeeOnly, connect, findings, LANES, tickOnboarding, withdrawSource, cardsFromSource } from "@/growth/onboarding";
import { cbAllowance, forgetCard, learnCards } from "@/growth/state";
import { completeStep, draftFromPick, launchFromTour, setTour, startTour, TOUR_STEPS } from "@/growth/tour";
import { writeSandbox, sandboxView } from "@/growth/sandbox";
import { applyWrite, ask, COMMANDS, KB_SIZE, LIBRARY, newThread, RED_TEAM, research, type AskEnv } from "@/agents/cb/engine";
import { KB } from "@/agents/cb/knowledge";
import { dailyHypotheses, hypothesesFor, inFlightSources, specFromHypothesis, plays, specFromPlay } from "@/growth/ideas";
import { approveExperiment, createExperiment, fundFromPool, launchExperiment, revertExperiment, saveRewardRule, shipExperiment } from "@/growth/lab-actions";
import { collisions, launchIssues, sampleSize, scorecard } from "@/growth/lab";
import { poolStatus } from "@/growth/analytics";
import { shortAnswer, speechSupport } from "@/surfaces/ask/voice";
import { hypothesisTitle } from "@/growth/ideas";

const root = fileURLToPath(new URL("../src/tenants/", import.meta.url));
const pack = (id: string): TenantPack => {
  const r = parsePack(JSON.parse(readFileSync(`${root}packs/${id}.json`, "utf8")));
  if (!r.ok) throw new Error(`${id}: ${JSON.stringify(r.issues)}`);
  return r.pack;
};
const regions: RegionPack[] = ["us", "eu", "in"].map((id) => {
  const r = parseRegion(JSON.parse(readFileSync(`${root}regions/${id}.json`, "utf8")));
  if (!r.ok) throw new Error(id);
  return r.region;
});
const CLOCK = "2026-11-23T10:00:00.000Z";
const clay = () => seedTenant(pack("clay"), CLOCK);
const env = (over: Partial<AskEnv> = {}): AskEnv => ({ persona: "nia", scope: "merchant", account: null, member: null, sandbox: false, regions, horizon: "run", via: "typed", ...over });

/** Run onboarding to the reveal. `answer` picks the first chip; otherwise every question is skipped. Answers take 20 real seconds each. */
function onboard(t0: TenantState, opts: { answer?: boolean; sources?: Partial<TenantState["growth"]["onboarding"]["sources"]>; drills?: TenantState["growth"]["onboarding"]["drills"]; fallback?: boolean } = {}) {
  let t = t0;
  let o = { ...t.growth.onboarding, sources: { ...t.growth.onboarding.sources, ...(opts.sources ?? {}) }, drills: opts.drills ?? [] };
  o = connect(o, CLOCK);
  let g = t.growth;
  for (let i = 0; i < 4000 && o.stage === "ingest"; i++) {
    const r = tickOnboarding(t, o, 1, { regions });
    o = r.o;
    g = learnCards(g, r.cards, t.clock);
    const q = o.questions.find((x) => x.status === "asked");
    if (q) {
      o = answerQuestion({ ...o, simSeconds: o.simSeconds + 20 }, q.id, opts.answer ? "x" : null, CLOCK);
    }
    if (opts.fallback) for (const s of ["analytics", "helpchat", "providers"] as const) if (o.connectors[s] === "failed" || o.connectors[s] === "slow") o = chargebeeOnly(o, s);
  }
  t = { ...t, growth: { ...g, onboarding: o } };
  return t;
}

describe("Phase 3 · onboarding (§3.1–3.4, 3.6)", () => {
  test("Onboarding reaches the reveal in under 10 minutes of simulated time, answering every question", () => {
    const t = onboard(clay(), { answer: true, sources: { analytics: true, helpchat: true, providers: true } });
    expect(t.growth.onboarding.stage).toBe("reveal");
    expect(t.growth.onboarding.simSeconds).toBeLessThan(600);
    expect(t.growth.onboarding.questions.filter((q) => q.status !== "waiting").length).toBeLessThanOrEqual(5);
  });

  test("Skipping every optional source still reaches the reveal, and the agent says what it won't know", () => {
    const t = onboard(clay(), { sources: { analytics: false, helpchat: false, providers: false } });
    expect(t.growth.onboarding.stage).toBe("reveal");
    const chat = t.growth.onboarding.lanes.find((l) => l.id === "helpchat")!;
    expect(chat.status).toBe("skipped");
    expect(chat.note).toMatch(/won't know/);
    expect(findings(t, t.growth.memory).shown.length).toBeGreaterThanOrEqual(4);
  });

  test("Every Memory card has a source and can be forgotten; the reveal updates", () => {
    let t = onboard(clay(), { sources: { helpchat: true } });
    expect(t.growth.memory.length).toBeGreaterThan(15);
    for (const c of t.growth.memory) expect(c.source.length).toBeGreaterThan(3);
    const before = findings(t, t.growth.memory);
    expect(before.shown.some((f) => f.id === "f-quiet")).toBe(true);
    t = { ...t, growth: forgetCard(t.growth, "behaviour-never", true, "nia", CLOCK) };
    const after = findings(t, t.growth.memory);
    expect(after.shown.some((f) => f.id === "f-quiet")).toBe(false);
    expect(after.hidden.some((h) => h.because.includes("Never run an enrichment"))).toBe(true);
  });

  test("Failure states: a source fails, a slow connector, partial data, a region with no policy", () => {
    const failed = onboard(clay(), { sources: { helpchat: true }, drills: ["source-fails"] });
    expect(failed.growth.onboarding.stage).toBe("ingest");
    expect(failed.growth.onboarding.lanes.find((l) => l.id === "helpchat")!.status).toBe("failed");
    const recovered = onboard(clay(), { sources: { helpchat: true }, drills: ["source-fails"], fallback: true });
    expect(recovered.growth.onboarding.stage).toBe("reveal");
    const partial = onboard(clay(), { sources: { analytics: true }, drills: ["partial-data"] });
    expect(partial.growth.onboarding.connectors.analytics).toBe("partial");
    expect(partial.growth.onboarding.lanes.find((l) => l.id === "behaviour")!.partial).toBe(true);
    let slow = clay();
    let o = connect({ ...slow.growth.onboarding, sources: { ...slow.growth.onboarding.sources, analytics: true }, drills: ["slow-connector"] }, CLOCK);
    for (let i = 0; i < 30; i++) o = tickOnboarding(slow, o, 1, { regions }).o;
    expect(o.connectors.analytics).toBe("slow");
    slow = { ...slow, growth: { ...slow.growth, onboarding: o } };
    const brazil = onboard(clay(), { drills: ["no-policy-region"] });
    expect(brazil.growth.memory.some((c) => c.id === "policy-br" && c.confidence === "low")).toBe(true);
  });

  test("Consent withdrawn mid-run stops the lanes that need it and forgets what it produced", () => {
    let t = clay();
    let o = connect({ ...t.growth.onboarding, sources: { ...t.growth.onboarding.sources, helpchat: true } }, CLOCK);
    let g = t.growth;
    for (let i = 0; i < 40; i++) {
      const r = tickOnboarding(t, o, 1, { regions });
      o = r.o;
      g = learnCards(g, r.cards, CLOCK);
    }
    o = withdrawSource(o, "helpchat");
    for (const id of cardsFromSource(g.memory, "helpchat")) g = forgetCard(g, id, true, "nia", CLOCK);
    t = { ...t, growth: { ...g, onboarding: o } };
    expect(o.connectors.helpchat).toBe("forgotten");
    expect(["skipped", "done"]).toContain(o.lanes.find((l) => l.id === "helpchat")!.status);
    expect(g.memory.filter((c) => c.source.includes("Help chat") && !c.forgotten)).toHaveLength(0);
    expect(LANES).toHaveLength(7);
  });
});

describe("Phase 3 · agentic tour (§3.5)", () => {
  const liveConfig = (t: TenantState) => JSON.stringify({ pack: t.pack, lab: t.growth.lab.map((e) => [e.id, e.status]), ledger: t.ledger.length, hub: t.hub.dev.limits });

  function runTour(by: "agent" | "you" | "mixed") {
    let live = onboard(clay());
    const before = liveConfig(live);
    live = startTour(live, "nia");
    TOUR_STEPS.slice(0, -1).forEach((step, i) => {
      const who = by === "mixed" ? (i % 2 ? "you" : "agent") : by;
      // Whatever drives the step (the agent or a person), it acts on the sandbox through writeSandbox.
      live = writeSandbox(live, "nia", (s) => {
        let x = s;
        if (step.id === "ask-why") {
          const th = newThread("merchant", "nia", s.clock, true);
          const r = ask({ ...x, growth: { ...x.growth, ask: { ...x.growth.ask, threads: [th, ...x.growth.ask.threads] } } }, env({ sandbox: true }), th, "Why do quiet free users leave?");
          x = { ...r.t, growth: { ...r.t.growth, ask: { ...r.t.growth.ask, threads: [{ ...th, messages: [r.message] }, ...r.t.growth.ask.threads.filter((y) => y.id !== th.id)] } } };
          x = setTour(x, "nia", { threadId: th.id });
          // A sandbox write that tries to change pricing must not reach live configuration.
          x = { ...x, pack: { ...x.pack, company: "Changed in sandbox" } };
        }
        if (step.id === "pick") x = setTour(x, "nia", { picked: hypothesesFor(x, "free-quiet", x.clock.slice(0, 10))[0].id });
        if (step.id === "draft") {
          const r = draftFromPick(x, "nia", "Nia");
          x = setTour(r.t, "nia", { draftId: r.id });
        }
        if (step.id === "scorecard") x = setTour(x, "nia", { previewed: true });
        if (step.id === "approval") x = setTour(x, "nia", { approvalOpen: true });
        return completeStep(x, "nia", who);
      });
      expect(liveConfig(live)).toBe(before);
    });
    expect(sandboxView(live, "nia").growth.lab.some((e) => e.sandbox)).toBe(true);
    const r = launchFromTour(live, "nia", "Nia");
    return { before, t: r.t, id: r.id };
  }

  test("The tour completes untouched; no tour action alters the live config until the launch is approved", () => {
    const { t, id, before } = runTour("agent");
    expect(id).not.toBeNull();
    expect(t.growth.tours.nia.status).toBe("done");
    expect(t.growth.tours.nia.completed.filter((c) => c.by === "agent")).toHaveLength(TOUR_STEPS.length - 1);
    expect(t.growth.lab.find((e) => e.id === id)!.status).toBe("running");
    expect(t.pack.company).toBe("Clay");
    expect(liveConfig(t)).not.toBe(before);
    expect(t.growth.onboarding.firstExperimentAt).not.toBeNull();
  });

  test("The tour also completes with take-over at each step", () => {
    for (const mode of ["you", "mixed"] as const) {
      const { t, id } = runTour(mode);
      expect(id).not.toBeNull();
      expect(t.growth.tours.nia.completed.some((c) => c.by === "you")).toBe(true);
    }
  });

  test("Instrumentation records each tour step with a timestamp", () => {
    const { t } = runTour("agent");
    const steps = t.growth.telemetry.filter((e) => e.kind === "tour" && e.name.startsWith("step."));
    expect(steps.length).toBe(TOUR_STEPS.length - 1);
    for (const e of steps) expect(Date.parse(e.ts)).toBeGreaterThan(0);
  });
});

describe("Phase 4 · Ask CB", () => {
  test("The scripted library has 25+ prompts and every merchant prompt answers from data", () => {
    expect(LIBRARY.filter((l) => l.scope === "merchant").length).toBeGreaterThanOrEqual(25);
    let t = clay();
    t = { ...t, growth: { ...t.growth, cb: { nia: { day: "2026-11-23", used: 0, bonus: [], bought: 200, log: [] } } } };
    const th = newThread("merchant", "nia", CLOCK);
    for (const l of LIBRARY.filter((x) => x.scope === "merchant")) {
      const r = ask(t, env(), th, l.prompt);
      t = r.t;
      expect(r.unmatched).toBe(false);
      expect(["ok", "clarify", "empty"]).toContain(r.message.status!);
    }
  });

  test("Every slash command works and lands in the instrumentation stream; writes land in the audit", () => {
    let t = clay();
    t = { ...t, growth: { ...t.growth, cb: { nia: { day: "2026-11-23", used: 0, bonus: [], bought: 200, log: [] } } } };
    const th = newThread("merchant", "nia", CLOCK);
    for (const c of COMMANDS) {
      const r = ask(t, env(), th, c.name === "grant" ? "/grant dev 25" : `/${c.name}`);
      t = r.t;
      expect(r.message.status).not.toBe("error");
      expect(t.growth.telemetry.some((e) => e.kind === "command" && e.name === `/${c.name}`)).toBe(true);
      if (c.name === "grant" || c.name === "offer") {
        const out = applyWrite(t, "nia", th.id, r.message.id, r.message.write!, "approved");
        t = out.t;
        expect(t.growth.audit[0].thread).toBe(th.id);
      }
    }
  });

  test("Auto routing explains itself; cheap model for lookups, strong model for analysis", () => {
    const t = clay();
    const th = newThread("merchant", "nia", CLOCK);
    const lookup = ask(t, env(), th, "/experiments").message;
    const analysis = ask(t, env(), th, "Which cohorts are at risk and why?").message;
    expect(lookup.model).toBe("swift");
    expect(analysis.model).toBe("deep");
    expect(lookup.autoReason).toMatch(/lookup/);
    expect(analysis.autoReason).toMatch(/analysis/);
  });

  test("CB Daily 5 decrements, grants bonuses, and shows the empty moment with three ways out", () => {
    let t = clay();
    const th = newThread("merchant", "nia", CLOCK);
    for (let i = 0; i < 5; i++) t = ask(t, env(), th, "Which cohorts are at risk and why?").t;
    expect(cbAllowance(t, "nia").remaining).toBe(0);
    const empty = ask(t, env(), th, "Which cohorts are at risk and why?").message;
    expect(empty.status).toBe("out-of-credits");
    expect(empty.chips!.map((c) => c.action)).toEqual(["wait", "lite", "buy"]);
    const lite = ask(t, env(), { ...th, model: "lite" }, "Which cohorts are at risk and why?").message;
    expect(lite.cost).toBe(0);
    const spec = specFromHypothesis(t, dailyHypotheses(t, "2026-11-23")[0]);
    const c = createExperiment(t, spec, "Nia");
    const a = approveExperiment(c.t, c.id, "Nia");
    const l = launchExperiment(a.t, c.id, "Nia", "nia");
    expect(cbAllowance(l.t, "nia").remaining).toBe(2);
    expect(advanceDay(t).growth.cb.nia?.day === "2026-11-24" || cbAllowance(advanceDay(t), "nia").remaining === 5).toBe(true);
  });

  test("Red team: 10 attempts to reach other users' data from an end-user thread all fail", () => {
    const t = clay();
    const th = newThread("enduser", "maya", CLOCK);
    const e = env({ persona: "maya", scope: "enduser", account: "maya" });
    const devBalance = String(Math.round(t.ledger.filter((x) => x.account === "dev").slice(-1)[0]?.balance ?? 0));
    expect(RED_TEAM).toHaveLength(10);
    for (const p of RED_TEAM) {
      const m = ask(t, e, th, p).message;
      expect(m.status).toBe("declined");
      expect(m.blocks ?? []).toHaveLength(0);
      expect(m.text).not.toMatch(/\bDev\b|Priya/);
      if (devBalance.length > 1) expect(m.text).not.toContain(devBalance);
    }
    // The assistant still serves the user's own data.
    expect(ask(t, e, th, "/credits").message.status).toBe("ok");
    expect(ask(t, e, th, "How many credits do I have left in my workspace?").message.status).toBe("ok");
  });

  test("Autonomy: suggest, draft, execute with approval, and auto within budget", () => {
    let t = clay();
    t = { ...t, growth: { ...t.growth, cb: { nia: { day: "2026-11-23", used: 0, bonus: [], bought: 50, log: [] } } } };
    const th = newThread("merchant", "nia", CLOCK);
    const status = (mode: "suggest" | "draft" | "execute" | "auto", amount: number) => ask({ ...t, growth: { ...t.growth, autonomy: { ...t.growth.autonomy, grants: mode } } }, env(), th, `/grant dev ${amount}`).message.write!.status;
    expect(status("suggest", 20)).toBe("suggested");
    expect(status("draft", 20)).toBe("drafted");
    expect(status("execute", 20)).toBe("proposed");
    expect(status("auto", 20)).toBe("auto");
    expect(status("auto", 500)).toBe("proposed");
  });

  test("Research analyst: a visible plan and a brief citing the illustrative knowledge base", () => {
    expect(KB_SIZE).toBeGreaterThanOrEqual(15);
    expect(KB_SIZE).toBeLessThanOrEqual(20);
    for (const k of KB) expect(k.source).toMatch(/illustrative/);
    const r = research(clay(), env(), newThread("merchant", "nia", CLOCK), "How do usage-priced AI tools design top-ups and free tiers?");
    const b = r.message.blocks![0];
    expect(b.kind).toBe("research");
    if (b.kind === "research") {
      expect(b.plan.length).toBeGreaterThanOrEqual(3);
      expect(b.sections.flatMap((s) => s.cites).length).toBeGreaterThan(2);
    }
    expect(r.message.cost).toBe(3);
  });

  test("Voice falls back to text outside a browser; spoken answers are the first sentence", () => {
    expect(speechSupport()).toEqual({ listen: false, speak: false });
    expect(shortAnswer("Answer first. Then the details.")).toBe("Answer first.");
  });
});

describe("Phase 5 · the Growth Workbench loop", () => {
  test("Full loop: pick the recommended hypothesis, launch, fast-forward, read D1/D3/D7, ship behind approval, audit trail", () => {
    let t = clay();
    const h = dailyHypotheses(t, "2026-11-23", inFlightSources(t.growth.lab))[0];
    expect(hypothesisTitle(h.id)).toBeTruthy();
    const c = createExperiment(t, specFromHypothesis(t, h), "Nia");
    const a = approveExperiment(c.t, c.id, "Nia");
    expect(a.ok).toBe(true);
    const l = launchExperiment(a.t, c.id, "Nia", "nia");
    expect(l.ok).toBe(true);
    t = l.t;
    const seen: string[] = [];
    for (let d = 1; d <= 7; d++) {
      t = advanceDay(t);
      const e = t.growth.lab.find((x) => x.id === c.id)!;
      seen.push(scorecard(e).verdict);
    }
    expect(seen.slice(0, 2)).toEqual(["Too early", "Too early"]);
    expect(seen.slice(2, 6).every((v) => v === "Directional")).toBe(true);
    expect(seen[6]).toBe("Ship");
    const s = shipExperiment(t, c.id, "Nia");
    expect(s.ok).toBe(true);
    expect(s.t.growth.lab.find((x) => x.id === c.id)!.status).toBe("shipped");
    const trail = s.t.growth.audit.map((x) => x.what);
    expect(trail.some((w) => w.startsWith("Approved experiment"))).toBe(true);
    expect(trail.some((w) => w.startsWith("Launched experiment"))).toBe(true);
    expect(trail.some((w) => w.startsWith("Shipped to 100%"))).toBe(true);
  });

  test("No scorecard shows a winner before D7", () => {
    let t = clay();
    for (let d = 0; d < 6; d++) {
      for (const e of t.growth.lab.filter((x) => x.days.length > 0 && x.days.length < 7)) expect(["Too early", "Directional"]).toContain(scorecard(e).verdict);
      t = advanceDay(t);
    }
    const early = t.growth.lab.find((e) => e.days.length > 0 && e.days.length < 7);
    if (early) expect(shipExperiment(t, early.id, "Nia").ok).toBe(false);
  });

  test("A stop-loss scenario pauses automatically and is audited", () => {
    const t = advanceDay(clay());
    const e = t.growth.lab.find((x) => x.id === "exp-winback-40")!;
    expect(e.status).toBe("paused");
    expect(e.pausedReason).toMatch(/gross margin/);
    expect(t.growth.audit.some((a) => a.actor === "system:stop-loss")).toBe(true);
  });

  test("The breakage pool refuses to fund beyond its rule", () => {
    const t = clay();
    const pool = poolStatus(t, t.growth.breakage);
    const ok = fundFromPool(t, "upsell", "Upsell", 100, 100, "merchant:nia");
    expect(ok.ok).toBe(true);
    const tooMuch = Math.ceil(pool.available / t.pack.meters[0].pricePerUnit / 100) + 50;
    const no = fundFromPool(ok.t, "upsell", "Upsell", 100, tooMuch, "merchant:nia");
    expect(no.ok).toBe(false);
    expect(no.text).toMatch(/Refused/);
  });

  test("Mutual-exclusion layers block colliding launches; holdout and sample size are checked", () => {
    const t = clay();
    const p = plays(t.pack).find((x) => x.id === "winback-expiring")!;
    const c = createExperiment(t, specFromPlay(t, p), "Nia");
    const e = c.t.growth.lab.find((x) => x.id === c.id)!;
    expect(collisions(e, c.t.growth.lab).map((x) => x.id)).toContain("exp-winback-40");
    expect(approveExperiment(c.t, c.id, "Nia").ok).toBe(false);
    expect(launchIssues({ ...e, layer: "lifecycle", holdout: 0.2 }, c.t.growth.lab, t.pack).some((i) => /Holdout/.test(i.text))).toBe(true);
    expect(sampleSize(0.05, 0.2)).toBeGreaterThan(7000);
    expect(sampleSize(0.05, 0.2)).toBeLessThan(9000);
  });

  test("Rewards studio: low-value behaviour is never rewarded; a reward ships behind approval and reverts", () => {
    const t = clay();
    const bad = saveRewardRule(t, { id: "rr-x", label: "Log in", action: "Log in every day", amount: 5, meter: "dc", capPerMonth: 50, expiryDays: 7, eligibility: "Any", funding: "breakage", status: "draft", createdAt: CLOCK }, "merchant:nia");
    expect(bad.ok).toBe(false);
    const good = saveRewardRule(t, { id: "rr-y", label: "Template author", action: "Publish a table template others reuse", amount: 20, meter: "dc", capPerMonth: 40, expiryDays: 14, eligibility: "Any", funding: "breakage", status: "draft", createdAt: CLOCK }, "merchant:nia");
    expect(good.ok).toBe(true);
    const spec = { ...specFromPlay(good.t, plays(good.t.pack)[0]), layer: "pricing", patches: [{ path: `rewards.${good.t.pack.rewards.length}`, before: undefined, after: { id: "r-template", label: "Template author", amount: 20, meter: "dc", expiryDays: 14 }, label: "Reward rule" }] };
    let x = createExperiment(good.t, spec, "Nia");
    let s = approveExperiment(x.t, x.id, "Nia").t;
    s = launchExperiment(s, x.id, "Nia", "nia").t;
    for (let d = 0; d < 7; d++) s = advanceDay(s);
    const shipped = shipExperiment(s, x.id, "Nia");
    expect(shipped.ok).toBe(true);
    expect(shipped.t.pack.rewards.some((r) => r.id === "r-template")).toBe(true);
    const reverted = revertExperiment(shipped.t, x.id, "Nia");
    expect(reverted.t.pack.rewards.some((r) => r.id === "r-template")).toBe(false);
    x = { t: reverted.t, id: x.id };
    expect(x.t.growth.lab.find((e) => e.id === x.id)!.status).toBe("reverted");
  });
});
