// Phase 2 acceptance journeys (Credits Hub). Each journey drives the real UI through a
// small helper (`ui`) over a Playwright Page or FrameLocator, so the same steps run against
// a local dev server (tests/journeys/run.mjs) or the hosted preview.
//
//   1. Maya hits the free cap mid-run and recovers three different ways (plus own key)
//   2. Dev sets auto top-up with a cap and reaches the cap
//   3. A Member requests credits and Dev approves
//   4. A card fails and the soft landing holds
//   5. A cancel with a matched offer accepted and one declined
//   6. A plan change with undo
//   7. Every Hub screen is usable at 360px (no horizontal overflow)

/** Helper over a Playwright root (Page or FrameLocator) and its owning Page. */
export function makeUi(root, page, log = console.log) {
  const wait = (ms) => page.waitForTimeout(ms);
  const ui = {
    async reset() {
      await root.locator("body").evaluate(() => window.localStorage.clear());
      await page.reload({ waitUntil: "domcontentloaded" });
      await wait(4500);
    },
    async persona(name) {
      await root.getByRole("combobox", { name: "Persona" }).first().click();
      await wait(250);
      await root.getByRole("option", { name: new RegExp(`^${name}`) }).first().click();
      await wait(900);
    },
    async nav(label) {
      const mobile = root.getByRole("button", { name: "Open menu" });
      if (await mobile.count()) {
        await mobile.first().click();
        await wait(300);
      }
      try {
        await root.getByRole("button", { name: label, exact: true }).first().click({ timeout: 4000 });
      } catch (e) {
        await page.keyboard.press("Escape"); // close the mobile menu if the section isn't offered
        await wait(300);
        throw e;
      }
      await wait(800);
    },
    async click(name, opts = {}) {
      const loc = root.getByRole("button", { name, exact: !!opts.exact });
      await loc.nth(opts.nth ?? 0).click({ timeout: 8000 });
      await wait(opts.wait ?? 700);
    },
    async tab(name) {
      await root.getByRole("tab", { name, exact: true }).first().click({ timeout: 8000 });
      await wait(700);
    },
    /** Click if present right now (e.g. a strong-authentication prompt that only some regions show). */
    async maybe(name) {
      const loc = root.getByRole("button", { name });
      if (await loc.count()) {
        await loc.first().click();
        await wait(900);
        return true;
      }
      return false;
    },
    async text(t) {
      await root.getByText(t).first().click({ timeout: 8000 });
      await wait(500);
    },
    async select(label, value) {
      await root.getByLabel(label, { exact: true }).first().selectOption(value);
      await wait(500);
    },
    async fill(label, value) {
      await root.getByLabel(label, { exact: true }).first().fill(String(value));
      await wait(200);
    },
    async radio(label) {
      await root.getByLabel(label).first().click();
      await wait(300);
    },
    /** Wait until main's text matches `re` (or fail after `ms`). */
    async expect(re, ms = 12000) {
      const end = Date.now() + ms;
      let last = "";
      while (Date.now() < end) {
        last = await root.locator("body").innerText();
        if (re.test(last)) return true;
        await wait(250);
      }
      throw new Error(`Expected ${re} on screen. Saw: ${last.slice(0, 400).replace(/\n+/g, " | ")}`);
    },
    async notExpect(re) {
      const t = await root.locator("body").innerText();
      if (re.test(t)) throw new Error(`Did not expect ${re} on screen`);
    },
    async state() {
      return root.locator("body").evaluate(() => {
        const k = Object.keys(window.localStorage).find((x) => x.endsWith(":records"));
        return k ? JSON.parse(window.localStorage.getItem(k)) : null;
      });
    },
    async overflow() {
      return root.locator("body").evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    },
    log,
    wait,
  };
  return ui;
}

/** A stored payment prompt (EU/India strong authentication) is approved when it appears. */
async function approvePrompt(ui) {
  await ui.wait(400);
  await ui.maybe(/^(Approve in banking app|Verify payment)$/);
}

export const journeys = [
  {
    name: "Maya hits the free cap mid-run and recovers three different ways",
    async run(ui) {
      const hitCap = async () => {
        await ui.reset();
        await ui.persona("Maya");
        await ui.nav("Tables");
        await ui.click("Add enrichment column");
        await ui.select("Enrichment column", "company");
        await ui.click(/^Hold .* and run$/);
        await ui.expect(/Paused at row \d+ of 150, nothing lost/);
        await ui.expect(/Data Credits ran out at row \d+/);
      };
      // 1. Starter pack, then the run continues to the end
      await hitCap();
      await ui.click("Buy and continue");
      await approvePrompt(ui);
      await ui.expect(/Finished · \d+ of 150 found/);
      ui.log("  recovered: starter pack");
      // 2. Wait for the reset: the run is parked and resumes by itself on the reset date
      await hitCap();
      await ui.click("Resume at reset");
      await ui.expect(/Waiting for the reset on \d+ \w+/);
      ui.log("  recovered: wait for reset");
      // 3. Upgrade with the proration preview, then the run continues
      await hitCap();
      await ui.click("See proration and upgrade");
      await approvePrompt(ui);
      await ui.expect(/Finished · \d+ of 150 found/);
      await ui.nav("Plan");
      await ui.expect(/You can undo this until/);
      ui.log("  recovered: upgrade with proration");
      // 4. The seeded paused run finishes on the customer's own key (Data Credits drop to zero)
      await ui.reset();
      await ui.persona("Maya");
      await ui.nav("Tables");
      await ui.expect(/Paused at row 43 of 150/);
      await ui.click("Use my key");
      await ui.expect(/Finished · \d+ of 150 found/);
      ui.log("  recovered: own API key");
    },
  },
  {
    name: "Dev sets auto top-up with a cap and reaches the cap",
    async run(ui) {
      await ui.reset();
      await ui.persona("Dev");
      await ui.nav("Top-up packs");
      await ui.fill("When balance drops below", 1000);
      await ui.fill("Add (Data Credits)", 1500);
      await ui.fill("Monthly spend cap (USD)", 300);
      await ui.select("At the cap", "ask");
      await ui.click("Save auto top-up");
      await ui.expect(/never spends more than \$300 a month/);
      await ui.nav("Tables");
      await ui.click("Add enrichment column");
      await ui.select("Enrichment column", "phone");
      await ui.click(/^Hold .* and run$/);
      await ui.expect(/Paused at row [\d,]+ of 4,200, nothing lost/, 30000);
      await ui.expect(/Auto top-up stopped at your \$300 monthly cap/);
      const s = await ui.state();
      const t = s.tenants[s.activeTenant];
      const autos = t.hub.dev.charges.filter((c) => c.description.includes("auto top-up") && c.status === "paid");
      if (autos.length < 2) throw new Error(`Expected at least 2 automatic top-ups before the cap, saw ${autos.length}`);
      if (!t.hub.dev.capAsk) throw new Error("Expected the cap to ask an admin to allow one more pack");
      await ui.nav("Home");
      await ui.expect(/Auto top-up stopped at your \$300 monthly cap/);
      await ui.click(/^Allow one more/);
      await ui.expect(/Cap raised by/);
      ui.log(`  ${autos.length} auto top-ups, then the cap held and asked`);
    },
  },
  {
    name: "A Member requests credits and Dev approves",
    async run(ui) {
      await ui.reset();
      await ui.persona("Priya");
      await ui.nav("Tables");
      await ui.text("Mobile numbers for call blocks");
      await ui.click("Add enrichment column");
      await ui.select("Enrichment column", "phone");
      await ui.expect(/limit has [\d,]+ left, so this run pauses at about row/);
      await ui.click(/^Hold .* and run$/);
      await ui.expect(/Paused at row \d+ of 60, nothing lost/);
      await ui.click("Request credits", { exact: true, nth: 0 });
      await ui.click("Send request", { wait: 1200 });
      await ui.expect(/Waiting for approval/);
      await ui.persona("Dev");
      await ui.nav("Home");
      await ui.expect(/Priya asked for [\d,]+ Data Credits/);
      await ui.click("Approve", { exact: true });
      await ui.expect(/Approved\./);
      await ui.nav("Limits");
      await ui.expect(/Priya's limit \(approved request\)/);
      await ui.persona("Priya");
      await ui.nav("Tables");
      await ui.text("Mobile numbers for call blocks");
      await ui.click("Resume run");
      await ui.expect(/Finished · \d+ of 60 found/);
    },
  },
  {
    name: "A card fails and the soft landing holds",
    async run(ui) {
      await ui.reset();
      await ui.persona("Dev");
      await ui.nav("Brain");
      await ui.tab("Clock");
      await ui.click("Apply", { nth: 2, wait: 1000 });
      await ui.expect(/Now: soft landing until/);
      await ui.persona("Dev");
      await ui.nav("Home");
      await ui.expect(/renewal didn't go through\. Nothing is paused\./);
      // Credits keep working: a run goes ahead during the grace window
      await ui.nav("Tables");
      await ui.expect(/Your \$495(\.00)? renewal didn't go through\. Credits keep working until/);
      await ui.text("Inbound lead enrichment");
      await ui.click("Add enrichment column");
      await ui.select("Enrichment column", "email");
      await ui.click(/^Hold .* and run$/);
      await ui.expect(/Finished · \d+ of 120 found/);
      await ui.nav("Billing");
      await ui.expect(/Retry timeline|Smart retry, day 1/);
      await ui.expect(/Exports are never blocked/);
      // Grace ends unpaid: runs pause, exports stay open, one-tap update recovers
      await ui.nav("Brain");
      await ui.tab("Clock");
      await ui.click("Apply", { nth: 3, wait: 1000 });
      await ui.persona("Dev");
      await ui.nav("Billing");
      await ui.expect(/Runs are paused until the \$495(\.00)? renewal is paid/);
      await ui.click("Export usage and invoices");
      await ui.click(/^Update card and retry$/);
      await approvePrompt(ui);
      await ui.expect(/Recovered/);
    },
  },
  {
    name: "Cancel with a matched offer accepted, then one declined",
    async run(ui) {
      await ui.reset();
      await ui.persona("Dev");
      await ui.nav("Plan");
      await ui.click("Cancel subscription");
      await ui.expect(/Here's exactly what happens/);
      await ui.radio("Credits run out too quickly");
      await ui.expect(/A 20% rollover bonus/);
      await ui.click("Take this", { nth: 1, wait: 1000 });
      await ui.expect(/bonus Data Credits added, valid 60 days/);
      await ui.click("Cancel subscription");
      await ui.radio("It costs too much for what I use");
      await ui.expect(/Bring your own API key/);
      await ui.click("No thanks, cancel", { wait: 1000 });
      await ui.expect(/Cancels \d+ \w+/);
      const s = await ui.state();
      const ex = s.tenants[s.activeTenant].exitSurveys;
      const outcomes = ex.map((e) => `${e.reason}:${e.offer}:${e.outcome}`);
      if (!outcomes.includes("ran-out:rollover:accepted") || !outcomes.some((o) => o.startsWith("too-expensive:") && o.endsWith(":cancelled"))) throw new Error(`Exit surveys missing: ${outcomes.join(", ")}`);
      await ui.click("Keep my subscription");
      await ui.expect(/Cancellation withdrawn/);
    },
  },
  {
    name: "Plan change with undo",
    async run(ui) {
      await ui.reset();
      await ui.persona("Dev");
      await ui.nav("Plan");
      await ui.click("Try this", { nth: 0 });
      await ui.click(/^Change now/);
      await approvePrompt(ui);
      await ui.expect(/You can undo this until/);
      let s = await ui.state();
      if (!s.tenants[s.activeTenant].hub.dev.planChange) throw new Error("No plan change recorded");
      await ui.click("Undo", { exact: true });
      await ui.expect(/Back on Growth/);
      s = await ui.state();
      const pc = s.tenants[s.activeTenant].hub.dev.planChange;
      if (!pc.undone) throw new Error("Plan change not undone");
      const ch = s.tenants[s.activeTenant].hub.dev.charges.find((c) => c.id === pc.chargeId);
      if (ch && ch.status !== "refunded") throw new Error("Proration charge not refunded");
    },
  },
];

/** 360px check: every Hub section for each Hub persona, no horizontal overflow. */
export const narrow = {
  name: "All Hub screens usable at 360px",
  sections: ["Home", "Usage", "Tables", "Top-up packs", "Limits", "Rewards", "Plan", "Billing", "Lifecycle"],
  personas: ["Maya", "Dev", "Priya"],
};
