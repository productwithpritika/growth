// Runs the Phase 2 journeys against a running app with Playwright (Chromium).
//
//   APP_URL=http://localhost:5173/ node tests/journeys/run.mjs            # Phase 2 journeys
//   APP_URL=... PHASE=345 node tests/journeys/run.mjs                    # Phases 3–5 journeys
//   APP_URL=... PHASE=678 node tests/journeys/run.mjs                    # Phases 6–8 journeys
//   APP_URL=... ONLY="Plan change" node tests/journeys/run.mjs            # one journey
//
// Playwright isn't a dependency of the app itself; run with one available, for example
// `npx -p playwright@1 node tests/journeys/run.mjs` after `npx playwright install chromium`.
import { chromium } from "playwright";
const { journeys, makeUi, narrow } = await import(process.env.PHASE === "345" ? "./phase345.journeys.mjs" : process.env.PHASE === "678" ? "./phase678.journeys.mjs" : "./phase2.journeys.mjs");

const url = process.env.APP_URL ?? "http://localhost:5173/";
const only = process.env.ONLY;
const browser = await chromium.launch();
let failed = 0;

async function fresh(width = 1280, height = 900) {
  const page = await browser.newPage({ viewport: { width, height } });
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2500);
  return { page, ui: makeUi(page, page) };
}

for (const j of journeys) {
  if (only && !j.name.includes(only)) continue;
  const { page, ui } = await fresh();
  const t0 = Date.now();
  try {
    await j.run(ui);
    console.log(`PASS ${j.name} (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
  } catch (e) {
    failed++;
    console.log(`FAIL ${j.name}\n  ${String(e).slice(0, 600)}`);
  }
  await page.close();
}

if (!only || narrow.name.includes(only)) {
  const { page, ui } = await fresh(360, 800);
  const bad = [];
  for (const p of narrow.personas) {
    await ui.persona(p);
    for (const s of narrow.sections) {
      try {
        await ui.nav(s);
      } catch {
        continue; // the section isn't offered to this persona or role
      }
      const o = await ui.overflow();
      if (o > 1) bad.push(`${p} · ${s}: ${o}px`);
    }
  }
  if (bad.length) {
    failed++;
    console.log(`FAIL ${narrow.name}\n  ${bad.join("\n  ")}`);
  } else console.log(`PASS ${narrow.name}`);
  await page.close();
}

await browser.close();
process.exit(failed ? 1 : 0);
