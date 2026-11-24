// Phase 2 (Credits Hub) rules as pure, tested functions: `bun test tests/`.
// The UI journeys that exercise the same rules end to end are in tests/journeys/.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parsePack, type TenantPack } from "@/tenants/schema";
import { seedTenant, advanceDay } from "@/sim/seed";
import type { TenantState } from "@/core/types";
import { balanceOf, heldOf, holdsOf, verifyChain } from "@/core/ledger";
import { advanceTableRun, buyStarterPack, estimateColumn, resumeTableRun, shrinkTableRun, startTableRun, tablesOf, waitForReset } from "@/core/table-run";
import { allowOneMore, applyPlanChange, acceptOffer, cancelSubscription, changedMyMind, decideRequest, previewPlanChange, requestCredits, saveAutoTopUp, undoPlanChange, upsertLimit, applyCoupon, pauseSubscription } from "@/core/hub-actions";
import { paymentScenario, retryRenewal } from "@/core/dunning";
import { planFit } from "@/core/plan-fit";
import { breakdown, costPerVerified, runHistory, usageCsv } from "@/core/usage-history";
import { sparkStatus } from "@/core/rewards-program";
import { lifecycleOf } from "@/core/lifecycle";
import { can } from "@/core/team";
import { mutateHub } from "@/core/actions";
import { afterQualifyingUsage } from "@/core/rewards-program";

const root = fileURLToPath(new URL("../src/tenants/packs/", import.meta.url));
const pack = (id: string): TenantPack => {
  const r = parsePack(JSON.parse(readFileSync(`${root}${id}.json`, "utf8")));
  if (!r.ok) throw new Error(`${id}: ${JSON.stringify(r.issues)}`);
  return r.pack;
};
const CLOCK = "2026-11-23T10:00:00.000Z";
const clay = () => seedTenant(pack("clay"), CLOCK);
const runToEnd = (s: TenantState, account: string, id: string) => {
  for (let i = 0; i < 400; i++) {
    const r = advanceTableRun(s, account, id, 50);
    s = r.state;
    if (r.result !== "running") return { s, status: r.result };
  }
  return { s, status: "running" as const };
};
const run = (s: TenantState, account: string, id: string) => s.hub[account].runs.find((r) => r.id === id)!;

describe("Pre-run estimator and holds (§2.3)", () => {
  test("A 4,200-row estimate gives a range, the free not-found share, a hold capped at the balance and the balance after", () => {
    const t = clay();
    const e = estimateColumn(t, "dev", "dev", { id: "estimator", name: "India SaaS" }, "email", 4200);
    const dc = e.meters.find((m) => m.meter === "dc")!;
    expect(dc.low).toBeLessThan(dc.expected);
    expect(dc.expected).toBeLessThan(dc.high);
    expect(e.notFoundShare).toBeCloseTo(0.38, 2);
    expect(dc.hold).toBeLessThanOrEqual(dc.balance);
    expect(dc.after).toBeCloseTo(dc.balance - dc.expected, 1);
  });
  test("Own key drops Data Credits to zero and keeps Actions", () => {
    const t = clay();
    const e = estimateColumn(t, "dev", "dev", { id: "estimator", name: "India SaaS" }, "byok-email", 4200);
    expect(e.meters.find((m) => m.meter === "dc")!.expected).toBe(0);
    expect(e.meters.find((m) => m.meter === "act")!.expected).toBe(4200);
  });
  test("Confirming places a hold; finishing debits what was used and releases the rest; the chain verifies", () => {
    let s = clay();
    const before = balanceOf(s.ledger, "dev", "dc");
    const st = startTableRun(s, "dev", { member: "dev", table: { id: "estimator", name: "India SaaS" }, stepId: "email", rows: 50, byok: false });
    expect(st.result.ok).toBe(true);
    s = st.state;
    const id = (st.result as { runId: string }).runId;
    expect(heldOf(s.ledger, "dev", "dc")).toBeGreaterThan(0);
    const done = runToEnd(s, "dev", id);
    expect(done.status).toBe("done");
    const r = run(done.s, "dev", id);
    expect(r.done).toBe(50);
    expect(holdsOf(done.s.ledger, "dev").filter((h) => h.holdId === `hold:${id}:1` && h.status === "open").length).toBe(0);
    expect(balanceOf(done.s.ledger, "dev", "dc")).toBeCloseTo(before - (r.used.dc ?? 0), 1);
    expect(r.released.dc).toBeGreaterThan(0);
    expect(verifyChain(done.s.ledger).ok).toBe(true);
  });
});

describe("Mid-run exhaustion (§2.4)", () => {
  test("Maya's run pauses cleanly mid-way and every row before the pause is kept", () => {
    let s = clay();
    const st = startTableRun(s, "maya", { member: "maya", table: { id: "weekly-list", name: "Weekly prospect list" }, stepId: "company", rows: 150, byok: false });
    s = st.state;
    const id = (st.result as { runId: string }).runId;
    const out = runToEnd(s, "maya", id);
    expect(out.status).toBe("paused");
    const r = run(out.s, "maya", id);
    expect(r.done).toBeGreaterThan(0);
    expect(r.done).toBeLessThan(150);
    expect(r.pausedReason?.code).toBe("insufficient_balance");
    expect(balanceOf(out.s.ledger, "maya", "dc")).toBeGreaterThanOrEqual(0);
  });
  test("Recover by starter pack, by own key, by running smaller, or by waiting for the reset", () => {
    const base = clay();
    const seeded = base.hub.maya.runs.find((r) => r.status === "paused")!;
    // Starter pack
    let a = buyStarterPack(base, "maya").state;
    a = resumeTableRun(a, "maya", seeded.id, "continue", "user:maya").state;
    expect(runToEnd(a, "maya", seeded.id).status).toBe("done");
    // Own key
    const b = resumeTableRun(base, "maya", seeded.id, "byok", "user:maya").state;
    const bd = runToEnd(b, "maya", seeded.id);
    expect(bd.status).toBe("done");
    expect(run(bd.s, "maya", seeded.id).byok).toBe(true);
    // Run smaller: trimmed rows are never run or charged
    const c = shrinkTableRun(base, "maya", seeded.id, 5, "user:maya");
    expect(c.result.ok).toBe(true);
    const cd = runToEnd(c.state, "maya", seeded.id);
    expect(run(cd.s, "maya", seeded.id).rows).toBe(seeded.done + 5);
    // Wait for the reset: resumes by itself at renewal
    let w = waitForReset(base, "maya", seeded.id, "user:maya").state;
    expect(run(w, "maya", seeded.id).status).toBe("waiting");
    for (let i = 0; i < 9; i++) w = advanceDay(w);
    expect(run(w, "maya", seeded.id).status).toBe("done");
  });
  test("A blocking member limit pauses the run at the limit; an approved request lets it finish", () => {
    let s = clay();
    const st = startTableRun(s, "dev", { member: "priya", table: { id: "phones", name: "Mobile numbers for call blocks" }, stepId: "phone", rows: 60, byok: false });
    s = st.state;
    const id = (st.result as { runId: string }).runId;
    const p = runToEnd(s, "dev", id);
    expect(p.status).toBe("paused");
    expect(run(p.s, "dev", id).pausedReason?.code).toBe("spend_limit");
    const rq = requestCredits(p.s, "dev", { id: "priya", name: "Priya" }, "dc", 200, "Finish call blocks");
    expect(rq.state.hub.dev.notices.some((n) => n.channel === "email" && n.action === "Approve")).toBe(true);
    const ok = decideRequest(rq.state, "dev", rq.result, true, "user:dev");
    expect(ok.result.ok).toBe(true);
    expect(ok.state.hub.dev.limits.find((l) => l.target === "priya")!.amount).toBe(550);
    expect(ok.state.hub.dev.audit.some((a) => a.area === "requests")).toBe(true);
    const r2 = resumeTableRun(ok.state, "dev", id, "continue", "user:priya").state;
    expect(runToEnd(r2, "dev", id).status).toBe("done");
  });
});

describe("Auto top-up (§2.5)", () => {
  test("Tops up below the threshold until the monthly cap, then asks an admin for one more", () => {
    let s = saveAutoTopUp(clay(), "dev", { enabled: true, meter: "dc", threshold: 1000, units: 1500, atCap: "ask", onFail: "backup", pausedUntil: null }, 300, "user:dev").state;
    const st = startTableRun(s, "dev", { member: "dev", table: { id: "estimator", name: "India SaaS" }, stepId: "phone", rows: 4200, byok: false });
    s = st.state;
    const id = (st.result as { runId: string }).runId;
    const out = runToEnd(s, "dev", id);
    expect(out.status).toBe("paused");
    const paid = out.s.hub.dev.charges.filter((c) => c.description.includes("auto top-up") && c.status === "paid");
    expect(paid.length).toBeGreaterThanOrEqual(2);
    expect(paid.reduce((x, c) => x + c.amount, 0)).toBeLessThanOrEqual(300);
    expect(out.s.hub.dev.capAsk).not.toBeNull();
    const more = allowOneMore(out.s, "dev", "user:dev").state;
    expect(more.hub.dev.topUpCap).toBeGreaterThan(300);
    expect(more.hub.dev.capAsk).toBeNull();
  });
  test("An expired default card falls back to the backup method", () => {
    const t = clay();
    const auto = t.hub.dev.charges.find((c) => c.description.includes("auto top-up"))!;
    expect(auto.status).toBe("paid");
    expect(auto.reason).toContain("backup");
  });
  test("'I changed my mind' pauses auto top-up and refunds the last one while its credits are untouched", () => {
    let s = clay();
    s = mutateHub(s, "dev", (ctx) => {
      ctx.hub.card = { ...ctx.hub.card, status: "ok" };
      return true;
    }).state;
    s = saveAutoTopUp(s, "dev", { ...s.hub.dev.autoTopUp, threshold: 5000 }, 1000, "user:dev").state;
    const before = balanceOf(s.ledger, "dev", "dc");
    const r = changedMyMind(s, "dev", 7, true, "user:dev");
    expect(r.result).toBeGreaterThan(0);
    expect(r.state.hub.dev.autoTopUp.pausedUntil).not.toBeNull();
    expect(balanceOf(r.state.ledger, "dev", "dc")).toBeLessThan(before);
    expect(r.state.hub.dev.charges.some((c) => c.status === "refunded")).toBe(true);
  });
});

describe("Governance (§2.6)", () => {
  test("Role matrix: Members run and request, Billing pays, only Admins set limits and roles", () => {
    expect(can("member", "run")).toBe(true);
    expect(can("member", "buy")).toBe(false);
    expect(can("billing", "buy")).toBe(true);
    expect(can("billing", "limits")).toBe(false);
    expect(can("admin", "roles")).toBe(true);
  });
  test("Every limit change lands in the audit log with before and after", () => {
    const s = upsertLimit(clay(), "dev", { id: "lim_x", scope: "table", target: "inbound", meter: "dc", amount: 500, behaviour: "warn" }, "user:dev", "Inbound").state;
    const a = s.hub.dev.audit.at(-1)!;
    expect(a.area).toBe("limits");
    expect(a.to).toContain("500");
  });
});

describe("Plan fit and plan change (§2.7)", () => {
  test("Replays 90 days in three windows and finds the cheapest fit and one that never runs out", () => {
    const f = planFit(clay(), "dev");
    expect(f.windows.length).toBe(3);
    expect(f.cheapest).not.toBeNull();
    expect(f.noRunOut?.needsTopUps).toBe(false);
    expect(f.cheapest!.total).toBeLessThanOrEqual(f.noRunOut!.total);
  });
  test("Upgrades prorate now, downgrades wait for renewal, annual shows the discount", () => {
    const t = clay();
    const up = previewPlanChange(t, "dev", { planId: "growth", billing: "monthly", addOns: { dc: 2 } });
    expect(up.effective).toBe("now");
    expect(up.prorationUsd).toBeCloseTo(90 * (up.daysLeft / 30), 1);
    const down = previewPlanChange(t, "dev", { planId: "launch", billing: "monthly", addOns: {} });
    expect(down.effective).toBe("renewal");
    expect(down.prorationUsd).toBe(0);
    const yr = previewPlanChange(t, "dev", { planId: "growth", billing: "annual", addOns: {} });
    expect(yr.toMonthly).toBeCloseTo(495 * 0.9, 2);
  });
  test("A plan change can be undone within 24 hours: grants reversed, charge refunded", () => {
    const t = clay();
    const ch = applyPlanChange(t, "dev", { planId: "growth", billing: "monthly", addOns: { dc: 3 } }, "user:dev");
    expect(ch.result.ok).toBe(true);
    const undone = undoPlanChange(ch.state, "dev", "user:dev");
    expect(undone.result.ok).toBe(true);
    expect(undone.state.hub.dev.profile.addOns).toEqual({});
    expect(undone.state.hub.dev.charges.find((c) => c.id === ch.state.hub.dev.planChange!.chargeId)!.status).toBe("refunded");
    expect(verifyChain(undone.state.ledger).ok).toBe(true);
  });
});

describe("Rewards (§2.8)", () => {
  test("Daily Spark: one grant a qualifying day, 7-day expiry, monthly cap, reason code reward.spark", () => {
    const t = clay();
    const s = sparkStatus(t, "dev");
    expect(s.earnedThisCycle).toBeLessThanOrEqual(t.pack.hub.spark.monthlyCap);
    const grants = t.ledger.filter((e) => e.account === "dev" && e.reason === "reward.spark");
    expect(grants.length).toBeGreaterThan(0);
    expect(new Set(grants.map((g) => g.ts.slice(0, 10))).size).toBe(grants.length);
    for (const g of grants) expect(new Date(g.expiresAt!).getTime() - new Date(g.ts).getTime()).toBe(7 * 86_400_000);
  });
  test("Anti-abuse: no grant without a verified domain, and velocity limits hold", () => {
    let s = clay();
    s = mutateHub(s, "maya", (ctx) => {
      ctx.hub.rewardState.domainVerified = false;
      return true;
    }).state;
    const r = mutateHub(s, "maya", (ctx, ts) => afterQualifyingUsage(ctx, ts, 40, 30)).state;
    expect(r.hub.maya.rewardState.refused.at(-1)?.rule).toContain("verified work domain");
  });
});

describe("Payment failure and soft landing (§2.10)", () => {
  test("Renewal fails with no backup: grace window, retries scheduled, runs still allowed", () => {
    const s = paymentScenario(clay(), "dev", "renewal-fails").state;
    const d = s.hub.dev.dunning;
    expect(d.status).toBe("grace");
    expect(d.attempts.filter((a) => a.outcome === "scheduled").length).toBeGreaterThan(0);
    const st = startTableRun(s, "dev", { member: "dev", table: { id: "inbound", name: "Inbound lead enrichment" }, stepId: "email", rows: 20, byok: false });
    expect(st.result.ok).toBe(true);
  });
  test("Grace ends unpaid: new runs are blocked with a typed reason; a new card recovers it", () => {
    const s = paymentScenario(clay(), "dev", "grace-ends").state;
    expect(s.hub.dev.dunning.status).toBe("suspended");
    const st = startTableRun(s, "dev", { member: "dev", table: { id: "inbound", name: "Inbound lead enrichment" }, stepId: "email", rows: 20, byok: false });
    expect(st.result.ok).toBe(false);
    const fixed = mutateHub(s, "dev", (ctx) => {
      ctx.hub.card = { ...ctx.hub.card, status: "ok", expires: "12/29" };
      return true;
    }).state;
    expect(retryRenewal(fixed, "dev").state.hub.dev.dunning.status).toBe("recovered");
  });
  test("Renewal fails but the backup pays: recovered at once", () => {
    expect(paymentScenario(clay(), "dev", "renewal-fails-backup").state.hub.dev.dunning.status).toBe("recovered");
  });
});

describe("Pause, cancel and offers (§2.11)", () => {
  test("Reasons drive matched offers; accepted and declined outcomes are captured for the Workbench", () => {
    const t = clay();
    const a = acceptOffer(t, "dev", "ran-out", "rollover", "user:dev", null);
    expect(a.state.ledger.at(-1)!.source).toBe("promo");
    const c = cancelSubscription(a.state, "dev", "too-expensive", "downgrade", "user:dev").state;
    expect(c.hub.dev.status).toBe("cancelling");
    expect(c.exitSurveys.map((e) => `${e.reason}:${e.outcome}`)).toEqual(["ran-out:accepted", "too-expensive:cancelled"]);
  });
  test("Pause follows the tenant policy: Clay keeps credits working", () => {
    const s = pauseSubscription(clay(), "dev", 1, null, "user:dev").state;
    expect(s.hub.dev.pause?.policy).toBe("keep");
    const st = startTableRun(s, "dev", { member: "dev", table: { id: "inbound", name: "Inbound lead enrichment" }, stepId: "email", rows: 10, byok: false });
    expect(st.result.ok).toBe(true);
  });
  test("Coupons: unknown codes explain themselves; valid ones apply once", () => {
    expect(applyCoupon(clay(), "dev", "NOPE", "user:dev").result.ok).toBe(false);
    const ok = applyCoupon(clay(), "dev", "build10", "user:dev");
    expect(ok.result.ok).toBe(true);
    expect(applyCoupon(ok.state, "dev", "BUILD10", "user:dev").result.ok).toBe(false);
  });
});

describe("Usage explainer and lifecycle (§2.2, §2.12)", () => {
  test("90 days of runs break down by table, column, provider, model and member, and export to CSV", () => {
    const t = clay();
    const runs = runHistory(t, "dev", 90);
    expect(runs.length).toBeGreaterThan(30);
    for (const d of ["table", "column", "provider", "model", "member"] as const) expect(breakdown(t.pack, t.hub.dev, runs, d).length).toBeGreaterThan(0);
    const vc = costPerVerified(t.pack, runs);
    expect(vc.perVerified).toBeGreaterThan(0);
    expect(usageCsv(t.pack, t.hub.dev, runs).split("\n")[0]).toContain("verified");
  });
  test("Maya's lifecycle stage is 'limit hit' with a paused run; the table list includes her weekly list", () => {
    const t = clay();
    expect(lifecycleOf(t, "maya").current).toBe("limit-hit");
    expect(tablesOf(t, "maya").some((x) => x.name === "Weekly prospect list")).toBe(true);
  });
  test("Other tenants get the same Hub from config alone", () => {
    for (const id of ["builderco", "apico"]) {
      const t = seedTenant(pack(id), CLOCK);
      expect(tablesOf(t, "dev").length).toBeGreaterThan(0);
      expect(planFit(t, "dev").windows.length).toBe(3);
      expect(verifyChain(t.ledger).ok).toBe(true);
    }
  });
});
