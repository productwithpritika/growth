// Phases 6–8 acceptance journeys. Same helper as Phases 2–5 (`makeUi`), run against a local dev
// server (tests/journeys/run.mjs PHASE=678) or the hosted preview.
//
//   Phase 6: right-sizing and the scenario slider · register a skill (fail, then pass) · run an
//            eval with intervals · the gate blocks a failing skill, an audited override unblocks it
//   Phase 7: constraints change what an agent can send · the external agent split screen · the
//            kill switch halts agents · a Moment from plain words publishes and rolls back · the
//            embed works hosted and embedded, as drawer and modal
//   Phase 8: Pack Builder lint and load · flags, portfolio, isolation and injection tests ·
//            presenter mode · the same journeys on BuilderCo, APICo and SeatCo · 360px and a11y
import { makeUi as baseUi } from "./phase345.journeys.mjs";

export function makeUi(root, page, log = console.log) {
  const ui = baseUi(root, page, log);
  ui.switch = async (name) => {
    await root.getByRole("switch", { name, exact: true }).first().click({ timeout: 8000 });
    await ui.wait(600);
  };
  ui.choose = async (name) => {
    await root.getByRole("radio", { name, exact: true }).first().click({ timeout: 8000 });
    await ui.wait(500);
  };
  ui.disabled = async (name) => root.getByRole("button", { name }).first().isDisabled();
  ui.tenant = async (company) => {
    const mobile = root.getByRole("button", { name: "Open menu" });
    await root.getByRole("combobox", { name: "Tenant" }).first().click();
    await ui.wait(250);
    await root.getByRole("option", { name: new RegExp(`^${company}`) }).first().click();
    await ui.wait(1500);
    void mobile;
  };
  ui.sliderKeys = async (name, key, n) => {
    await root.getByRole("slider", { name }).first().focus();
    for (let i = 0; i < n; i++) await page.keyboard.press(key);
    await ui.wait(400);
  };
  /** Automated accessibility checks on the current screen: names, labels, ids, landmarks. */
  ui.a11y = async () =>
    root.locator("body").evaluate(() => {
      const out = [];
      const viaLabel = (el) => (el.id && document.querySelector(`label[for="${CSS.escape(el.id)}"]`)?.textContent) || el.closest("label")?.textContent || "";
      const name = (el) => (el.getAttribute("aria-label") || el.getAttribute("aria-labelledby") || el.textContent || el.getAttribute("title") || viaLabel(el) || "").trim();
      for (const b of document.querySelectorAll("button, [role=button], a[href]")) if (!name(b) && !b.querySelector("svg[aria-label], img[alt]")) out.push(`unnamed ${b.tagName.toLowerCase()} ${b.outerHTML.slice(0, 80)}`);
      for (const i of document.querySelectorAll("input:not([type=hidden]), select, textarea")) {
        const id = i.getAttribute("id");
        const labelled = i.getAttribute("aria-label") || i.getAttribute("aria-labelledby") || (id && document.querySelector(`label[for="${CSS.escape(id)}"]`)) || i.closest("label");
        if (!labelled) out.push(`unlabelled ${i.tagName.toLowerCase()} ${i.outerHTML.slice(0, 80)}`);
      }
      for (const img of document.querySelectorAll("img")) if (!img.hasAttribute("alt")) out.push("img without alt");
      const ids = [...document.querySelectorAll("[id]")].map((e) => e.id).filter(Boolean);
      const dup = ids.filter((x, i) => ids.indexOf(x) !== i);
      if (dup.length) out.push(`duplicate ids: ${[...new Set(dup)].slice(0, 5).join(", ")}`);
      if (!document.querySelector("main")) out.push("no main landmark");
      if (!document.querySelector("h1")) out.push("no h1");
      return out;
    });
  return ui;
}

const net = async (ui) => (await ui.body()).match(/Net revenue\s+([−-]?\$[\d,]+)/)?.[1] ?? "";

export const journeys = [
  {
    name: "Right-sizing recommends the mid-tier model; the slider moves the net effect; Create experiment drafts it",
    async run(ui) {
      await ui.reset();
      await ui.persona("Nia");
      await ui.nav("Evals");
      await ui.expect(/Switch Company research from Frontier L to Balanced M\. It scores 91 against 92/);
      const before = await net(ui);
      await ui.sliderKeys("Share of saved credits spent on more runs", "ArrowRight", 6);
      const after = await net(ui);
      if (!before || before === after) throw new Error(`Net revenue did not move: ${before} → ${after}`);
      ui.log(`  net revenue ${before} → ${after}`);
      await ui.click("Create experiment", { wait: 1200 });
      await ui.expect(/Balanced M as the default for Company research/);
      await ui.expect(/Rerun rate|User-reported low quality/);
    },
  },
  {
    name: "Register a skill end to end with a failing then passing validation",
    async run(ui) {
      await ui.reset();
      await ui.persona("Nia");
      await ui.nav("Evals");
      await ui.tab("Skills");
      await ui.click("Register a skill");
      await ui.click("Fetch");
      await ui.click("Validate");
      await ui.expect(/Declares side effects/);
      if (!(await ui.disabled("Register"))) throw new Error("Register should be disabled while checks fail");
      await ui.click("Use the read-only variant (no CRM write-back)");
      await ui.click("Honour an idempotency key");
      await ui.click("Set the timeout to 20 s");
      const typed = `vault-check-${Date.now().toString(36)}`;
      await ui.fill("4. API key or token", typed);
      await ui.click("Store", { exact: true });
      await ui.expect(/Only the fingerprint/);
      await ui.click("5. Run a test call");
      await ui.expect(/Returned output that matches the output schema/);
      await ui.click("Register", { exact: true, wait: 1200 });
      await ui.expect(/Score lead intent is registered/);
      const s = await ui.state();
      const sk = s.tenants[s.activeTenant].platform.evals.skills.find((x) => x.id === "score-lead-intent");
      if (!sk || sk.status !== "live") throw new Error("Skill not live");
      if (JSON.stringify(s).includes(typed)) throw new Error("The secret was stored");
    },
  },
  {
    name: "Run an eval in a synthetic tenant and see intervals",
    async run(ui) {
      await ui.reset();
      await ui.persona("Nia");
      await ui.nav("Evals");
      await ui.tab("Runs and results");
      await ui.click(/^Run eval · /, { wait: 1200 });
      await ui.expect(/Eval finished in sbx-clay-/);
      await ui.expect(/Isolated: nothing touches production/);
      await ui.expect(/Leaderboard/);
      await ui.expect(/9[12] \(\d+\.\d–\d+\.\d\)/);
      await ui.expect(/Failure clusters/);
    },
  },
  {
    name: "The gate blocks a launch on a failing skill; an audited override unblocks it",
    async run(ui) {
      await ui.reset();
      await ui.persona("Nia");
      await ui.nav("Evals");
      await ui.select("Skill", "find-work-email");
      await ui.expect(/Keep Frontier L/);
      await ui.click("Create experiment", { wait: 1200 });
      await ui.expect(/Quality gate failed for Find work email on Balanced M/);
      if (!(await ui.disabled("Request approval"))) throw new Error("Request approval should be disabled");
      await ui.nav("Evals");
      await ui.tab("Quality gate");
      await ui.fill("Reason (goes in the audit log)", "Pilot with one design partner who accepts lower recall");
      await ui.click("Request override");
      await ui.click("Review");
      await ui.click("Approve override", { wait: 1000 });
      await ui.nav("Experiments");
      await ui.expect(/launch allowed by an override approved by Nia/);
      await ui.click("Request approval");
      await ui.click("Approve", { exact: true, wait: 1000 });
      await ui.click("Launch", { wait: 1200 });
      await ui.expect(/is running/);
      const s = await ui.state();
      const audit = s.tenants[s.activeTenant].growth.audit.map((a) => a.what).join(" | ");
      if (!/Approved gate override/.test(audit)) throw new Error("No audit entry for the override");
    },
  },
  {
    name: "MCP: tool constraints change what an agent can send; writes go to approval",
    async run(ui) {
      await ui.reset();
      await ui.persona("Nia");
      await ui.nav("MCP Console");
      await ui.click("Call grant_reward", { wait: 900 });
      await ui.expect(/the maximum for grant_reward is 50/);
      await ui.fill("Maximum for amount", "100");
      await ui.press("Tab");
      await ui.click("Call grant_reward", { wait: 900 });
      await ui.expect(/Needs approval/);
      await ui.tab(/^Approvals and activity/);
      await ui.click("Approve", { exact: true, wait: 1200 });
      await ui.expect(/Approved and executed: Granted 80/);
      await ui.click("Explain this action", { wait: 600 });
      await ui.expect(/It ran after Nia approved it|It was refused|waits in Pending approvals/);
    },
  },
  {
    name: "External agent: balance then estimate with a scoped token; auto top-up routes to approval",
    async run(ui) {
      await ui.reset();
      await ui.persona("Nia");
      await ui.nav("MCP Console");
      await ui.tab("External agent demo");
      await ui.click("Can I run this table with the credits I have?", { wait: 900 });
      await ui.expect(/get_balance[\s\S]*estimate_run_cost/);
      await ui.expect(/^(Yes|Not quite)\./m);
      await ui.click("Turn on auto top-up", { wait: 900 });
      await ui.expect(/sent it for approval/);
      await ui.expect(/needs approval/);
      await ui.click("What's Maya's balance?", { wait: 900 });
      await ui.expect(/I can't see that\. This token is scoped to Dev's workspace/);
    },
  },
  {
    name: "Agents: run the Experiment Operator; the kill switch halts every agent",
    async run(ui) {
      await ui.reset();
      await ui.persona("Nia");
      await ui.nav("Agents");
      await ui.click("Run Experiment Operator now", { wait: 1200 });
      await ui.expect(/Read \d+ scorecards/);
      await ui.expect(/get_scorecard/);
      await ui.switch("Global kill switch");
      await ui.expect(/every agent and external client is halted/);
      await ui.expect(/Halted/);
      if (!(await ui.disabled("Run Hypothesis Agent now"))) throw new Error("Agents still runnable with the kill switch on");
    },
  },
  {
    name: "A Moment from plain words previews, publishes, versions and rolls back",
    async run(ui) {
      await ui.reset();
      await ui.persona("Nia");
      await ui.nav("Portal experiences");
      await ui.fill("In plain words", "Show a top-up banner to Growth users when forecast run-out is under 5 days, once per week");
      await ui.expect(/Shows a card to Growth workspaces when their Data Credits forecast runs out in under 5 days, at most once a week/);
      await ui.click("Save as a draft moment", { wait: 900 });
      await ui.click("Preview in Credits Hub", { wait: 700 });
      await ui.click("Ask to publish v1");
      await ui.click("Approve and publish", { wait: 1000 });
      await ui.expect(/Live v1/);
      await ui.fill("Moment in plain words", "Show a top-up banner to Growth users when forecast run-out is under 10 days, once per week");
      await ui.click("Draft v2", { wait: 800 });
      await ui.click("Ask to publish v2");
      await ui.click("Approve and publish", { wait: 1000 });
      await ui.expect(/Live v2/);
      await ui.click("Open Credits Hub as Dev", { wait: 1500 });
      await ui.expect(/You'll run out of Data Credits in about \d+ days/);
      await ui.persona("Nia");
      await ui.nav("Portal experiences");
      await ui.click("Roll back", { wait: 800 });
      await ui.expect(/Live v1/);
    },
  },
  {
    name: "The embed works embedded and hosted, as a drawer and a modal",
    async run(ui) {
      await ui.reset();
      await ui.persona("Nia");
      await ui.nav("Embed SDK");
      await ui.expect(/<cb-credits-hub/);
      await ui.click("Credits", { exact: true, wait: 900 });
      await ui.expect(/Embedded Credits Hub modules for Dev/);
      await ui.click(/^1,500 Data Credits/, { wait: 700 });
      await ui.press("Escape");
      await ui.expect(/onTopupStarted\(dc-1500/);
      await ui.choose("Modal");
      await ui.click("Credits", { exact: true, wait: 900 });
      await ui.expect(/Embedded Credits Hub modules for Dev/);
      await ui.press("Escape");
      await ui.choose("Hosted");
      await ui.expect(/billing\.clay\.example\/credits/);
      await ui.expect(/Rendered in the page/);
    },
  },
  {
    name: "Pack Builder: lint flags a risky configuration; a clean pack loads as a tenant",
    async run(ui) {
      await ui.reset();
      await ui.persona("Nia");
      await ui.nav("Pack Builder");
      await ui.switch("Allow a negative balance");
      await ui.expect(/no overdraft cap/);
      if (!(await ui.disabled("Load as a new tenant"))) throw new Error("Load should be blocked by a lint error");
      await ui.fill("Overdraft cap (0 = no cap)", "200");
      await ui.wait(400);
      await ui.notExpect(/no overdraft cap: one runaway/);
      await ui.click("Load as a new tenant");
      await ui.click("Approve and load", { wait: 2500 });
      const s = await ui.state();
      if (!s.tenants["northwind-teams"]) throw new Error("Tenant not loaded");
    },
  },
  {
    name: "Flags, portfolio, isolation and injection tests, product health",
    async run(ui) {
      await ui.reset();
      await ui.persona("Nia");
      await ui.nav("Roadmap and flags");
      await ui.switch("Kill Experiment lab");
      await ui.expect(/Experiment lab killed/);
      await ui.nav("Portfolio");
      await ui.expect(/Killed now: Experiment lab\. That blocks/);
      await ui.nav("Roadmap and flags");
      await ui.switch("Kill Experiment lab");
      await ui.nav("Trust and security");
      await ui.click("Run isolation tests", { wait: 900 });
      await ui.expect(/6 of 6 isolation tests passed/);
      await ui.click("Run injection tests", { wait: 1500 });
      await ui.expect(/6 of 6 injection tests passed/);
      await ui.nav("Product health");
      await ui.expect(/Monetization-moment conversion value per active account/);
    },
  },
  {
    name: "Presenter mode jumps to named moments and switches tenant",
    async run(ui) {
      await ui.reset();
      await ui.click("Presenter mode (Alt+Shift+P)");
      await ui.click(/Evals: model right-sizing/, { wait: 1200 });
      await ui.expect(/Switch Company research from Frontier L to Balanced M/);
      await ui.click(/External agent$/, { wait: 1200 });
      await ui.expect(/AI client · Dev/);
      await ui.press("Alt+Shift+N");
      await ui.wait(800);
      await ui.expect(/Agent roster/);
    },
  },
  {
    name: "The same journeys on BuilderCo, APICo and SeatCo",
    async run(ui) {
      await ui.reset();
      for (const co of ["BuilderCo", "APICo", "SeatCo"]) {
        await ui.tenant(co);
        await ui.persona("Dev");
        await ui.expect(new RegExp(`${co}|Credit pool|Balance`));
        await ui.persona("Nia");
        await ui.nav("Evals");
        await ui.expect(/Recommendation|Keep the default/i);
        await ui.nav("MCP Console");
        await ui.tab("External agent demo");
        await ui.click("Can I run this table with the credits I have?", { wait: 900 });
        await ui.expect(/^(Yes|Not quite)\./m);
        await ui.nav("Pack Builder");
        await ui.expect(/Lint across tenants/);
        ui.log(`  ${co}: hub, evals, external agent, pack lint`);
      }
    },
  },
  {
    name: "Automated accessibility checks on every new screen",
    async run(ui) {
      await ui.reset();
      await ui.persona("Nia");
      const bad = [];
      for (const s of ["Evals", "MCP Console", "Agents", "Portal experiences", "Embed SDK", "Pack Builder", "Roadmap and flags", "Portfolio", "Product health", "Trust and security"]) {
        await ui.nav(s);
        const issues = await ui.a11y();
        if (issues.length) bad.push(`${s}: ${issues.slice(0, 4).join("; ")}`);
      }
      if (bad.length) throw new Error(bad.join("\n  "));
    },
  },
];

export const narrow = {
  name: "Phase 6–8 screens usable at 360px",
  sections: ["Evals", "MCP Console", "Agents", "Portal experiences", "Embed SDK", "MCP usage and caps", "Pack Builder", "Onboard a tenant", "Roadmap and flags", "Portfolio", "Product health", "Trust and security"],
  personas: ["Nia"],
};
