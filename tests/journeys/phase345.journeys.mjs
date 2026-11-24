// Phases 3–5 acceptance journeys (Growth Workbench). Same helper as Phase 2 (`makeUi`), so the
// steps run against a local dev server (tests/journeys/run.mjs PHASE=345) or the hosted preview.
//
//   1. Onboarding to the reveal, then the agentic tour untouched to a live launch
//   2. The tour with take-over at every step
//   3. Full loop: pick the recommended hypothesis, launch, Time machine to D7, ship behind approval, audit trail
//   4. A stop-loss scenario pauses automatically
//   5. The breakage pool refuses to fund beyond its rule
//   6. Ask CB: slash commands, an approval with undo, and the CB Daily 5 empty moment
//   7. The Credits assistant refuses to show another user's data
//   8. Every Workbench screen is usable at 360px
import { makeUi as baseUi } from "./phase2.journeys.mjs";

/** The Phase 2 helper plus the page text (dialogs render outside main) and key presses. */
export function makeUi(root, page, log = console.log) {
  const ui = baseUi(root, page, log);
  ui.body = () => root.locator("body").innerText();
  ui.press = async (key) => {
    await page.keyboard.press(key);
    await ui.wait(400);
  };
  return ui;
}

async function onboard(ui, { answer = true } = {}) {
  await ui.reset();
  await ui.persona("Nia");
  await ui.nav("Get started");
  await ui.click("Connect and start learning", { wait: 1200 });
  await ui.select("Speed", "12");
  const chips = ["Inclusive; reverse charge only with a VAT ID", "Yes, it's a proposal", "Data Credits", "14 days"];
  const end = Date.now() + 90000;
  while (Date.now() < end) {
    const body = await ui.body();
    if (/Your monetization, in one view/.test(body)) return;
    if (answer) for (const c of chips) await ui.maybe(c);
    else await ui.maybe(/^Skip$/);
    await ui.wait(800);
  }
  throw new Error("Onboarding did not reach the reveal");
}

export const journeys = [
  {
    name: "Onboarding to the reveal, then the tour untouched to a live launch",
    async run(ui) {
      await onboard(ui);
      await ui.expect(/Time to first experiment/);
      await ui.click("Launch your first experiment", { wait: 1000 });
      await ui.expect(/Tour sandbox/);
      await ui.expect(/Approve and launch/, 90000);
      await ui.click("Approve and launch", { wait: 1500 });
      await ui.expect(/First experiment launched/);
      await ui.expect(/Reward the first enrichment with Daily Spark/);
      const s = await ui.state();
      const t = s.tenants[s.activeTenant];
      if (t.growth.onboarding.firstExperimentAt == null || t.growth.onboarding.firstExperimentAt >= 600) throw new Error(`Time to first experiment ${t.growth.onboarding.firstExperimentAt}`);
      if (t.growth.tours.nia.completed.filter((c) => c.by === "you" && c.id !== "launch").length) throw new Error("A step was not done by the agent");
      ui.log(`  time to first experiment ${t.growth.onboarding.firstExperimentAt}s simulated`);
    },
  },
  {
    name: "The tour with take-over at every step",
    async run(ui) {
      await onboard(ui, { answer: false });
      await ui.click("Launch your first experiment", { wait: 600 });
      await ui.click("Take over", { wait: 600 });
      await ui.nav("Cohorts");
      await ui.click(/^Free · quiet before a first enrichment/);
      await ui.click("Open Ask CB", { wait: 800 });
      await ui.fill("Message Ask CB", "Why do quiet free users leave?");
      await ui.click("Send", { wait: 1600 });
      await ui.click("Pick this", { wait: 800 });
      await ui.press("Escape");
      await ui.nav("Experiments");
      await ui.click("Draft the experiment from it", { wait: 1000 });
      await ui.click("Preview scorecard", { wait: 800 });
      await ui.click("Request approval", { wait: 1000 });
      await ui.click("Approve and launch", { wait: 1500 });
      await ui.expect(/First experiment launched/);
      const s = await ui.state();
      const done = s.tenants[s.activeTenant].growth.tours.nia.completed;
      const mine = done.filter((c) => c.by === "you").length;
      if (mine < 8) throw new Error(`Only ${mine} steps were taken over`);
    },
  },
  {
    name: "Full loop: hypothesis, launch, Time machine to D7, ship behind approval, audit trail",
    async run(ui) {
      await ui.reset();
      await ui.persona("Nia");
      await ui.nav("Hypotheses");
      await ui.click("Pick this one");
      await ui.click("Approve and launch", { wait: 1200 });
      await ui.expect(/Reward the first enrichment with Daily Spark/);
      await ui.click("Move the simulated clock 1 day forward", { wait: 2500 });
      await ui.expect(/Too early/);
      await ui.click("Move the simulated clock 3 days forward", { wait: 3000 });
      await ui.expect(/Directional/);
      await ui.click("Move the simulated clock 3 days forward", { wait: 3000 });
      await ui.expect(/Decide:/);
      await ui.click("Ship to 100%", { wait: 800 });
      await ui.click("Approve and ship", { wait: 1500 });
      await ui.expect(/Shipped to everyone/);
      await ui.nav("Ask CB");
      await ui.tab("Records");
      await ui.expect(/Shipped to 100%: Reward the first enrichment/);
      await ui.expect(/Launched experiment: Reward the first enrichment/);
    },
  },
  {
    name: "A stop-loss scenario pauses automatically",
    async run(ui) {
      await ui.reset();
      await ui.persona("Nia");
      await ui.nav("Experiments");
      await ui.click("Move the simulated clock 1 day forward", { wait: 2500 });
      await ui.click(/^Win-back at 40% off/);
      await ui.expect(/Paused automatically by the stop-loss/);
      await ui.expect(/gross margin is [\d.]+ points worse/);
    },
  },
  {
    name: "The breakage pool refuses to fund beyond its rule",
    async run(ui) {
      await ui.reset();
      await ui.persona("Sam");
      await ui.nav("Breakage pool");
      await ui.fill("Accounts", 1500);
      await ui.fill("Data Credits each", 2000);
      await ui.click("Fund from the pool", { wait: 900 });
      await ui.expect(/Refused: .* is more than the .* the funding rule allows/);
      await ui.fill("Data Credits each", 50);
      await ui.click("Fund from the pool", { wait: 900 });
      await ui.expect(/Commitments this month/);
    },
  },
  {
    name: "Ask CB: slash commands, an approval with undo, and the CB Daily 5 empty moment",
    async run(ui) {
      await ui.reset();
      await ui.persona("Nia");
      await ui.nav("Ask CB");
      const send = async (text) => {
        await ui.fill("Message Ask CB", text);
        await ui.click("Send", { wait: 1400 });
      };
      await send("/credits");
      await ui.expect(/Used 1 CB credit/);
      await send("/grant dev 25");
      await ui.click("Approve", { exact: true, wait: 1200 });
      await ui.expect(/Approved/);
      await send("/undo");
      await ui.click("Approve undo", { wait: 1200 });
      await send("Which cohorts are at risk and why?");
      await ui.expect(/CB Daily 5 is used up|Auto chose CB Deep/);
      await send("Which model should replace the costliest default?");
      await ui.expect(/CB Daily 5 is used up for today/);
      await ui.expect(/Wait until tomorrow/);
      await ui.click(/^Use CB Lite/, { wait: 1400 });
      await ui.expect(/gives the short version/);
    },
  },
  {
    name: "The Credits assistant refuses to show another user's data",
    async run(ui) {
      await ui.reset();
      await ui.persona("Maya");
      await ui.click("Open the Credits assistant", { wait: 900 });
      await ui.fill("Message Ask CB", "What's Dev's balance?");
      await ui.click("Send", { wait: 1400 });
      await ui.expect(/I can only see your own workspace/);
      await ui.fill("Message Ask CB", "/credits");
      await ui.click("Send", { wait: 1400 });
      await ui.expect(/Data Credits left/);
    },
  },
];

export const narrow = {
  name: "All Workbench screens usable at 360px",
  sections: ["Get started", "Today", "Cohorts", "Hypotheses", "Experiments", "Experiment plays", "Ask CB", "Churn arrest", "Plan optimiser", "Breakage pool", "Rewards studio", "Unit economics", "MCP usage and caps"],
  personas: ["Nia"],
};
