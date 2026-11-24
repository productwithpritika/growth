# Phase 2 · Credits Hub: what to click

Start from **Reset demo**, tenant **Clay**, horizon **Run**. About 12 minutes.

| # | Who · where | Click | What to say | What they see |
|---|---|---|---|---|
| 1 | Maya · Home | Nothing | "Every low, out or failed state is a designed moment, ordered by urgency." | Paused-run moment first, then 9x% of Data Credits used, both meters with run-out forecast, the "enough for about N verified emails" line, Today's Spark, plan fit, "What paying would change for you". |
| 2 | Maya · Tables | Weekly prospect list | "Her run ran out mid-way. Nothing is lost." | "Paused at row 43 of 150, nothing lost" and six options, each priced per credit: top up, starter pack, wait for the reset, own key, run smaller, upgrade with proration. |
| 3 | Maya · Tables | **Use my key** | "Own key: Data Credits go to zero, Actions remain." | The run picks up at row 44 and finishes live. |
| 4 | Maya · Tables | **Add enrichment column** → Company enrichment | "Show the meter before the bill." | Range, ~18% not found and free, hold, balance after, "covers about N of 150 rows". Confirm → it pauses live at the cap. Try **Buy and continue** (starter pack) or **See proration and upgrade**. |
| 5 | Maya · Lifecycle | **See the moment** on a few rows | "Eight stages, each with a guardrail." | Limit hit is current; never-activated shows the 2-nudge cap; quiet honours the opt-out switch. |
| 6 | Dev · Home | Nothing | "Dev hates surprise bills." | Expired-default-card moment (backup Visa covering), forecast, team spend by member with Priya near her blocking limit. |
| 7 | Dev · Usage | Last 90 days, **Member**, then **Why this cost** on a run | "Explain, don't just display." | Breakdown by table/column/provider/model/member, Data Credits apart from Actions, cost per verified email vs benchmark; the drawer shows per-row cost, free misses, retries, holds released. **Export CSV**, **Share read-only link** → open it. |
| 8 | Dev · Top-up packs | Set cap to 300, At the cap: **Ask an admin**, **Save** | "Auto top-up, on Dev's terms." | Falling price per credit, custom slider, failure handling, "I changed my mind". |
| 9 | Dev · Tables | India SaaS → Add column → Mobile phone → **Hold … and run** | "Hold, debit live, release." | Live row counter and debit; auto top-ups fire until the $300 cap, then "Paused at row …, nothing lost" with **Allow and continue**. |
| 10 | Member (Priya) · Tables | Mobile numbers → Add column → Mobile phone → run | "Members can run, not buy." | Estimate warns her limit pauses the run at about row N; it does. **Request credits** → **Send request**. |
| 11 | Dev · Home | **Approve** | "One tap from e-mail, chat or here." | Approved; Limits shows the raised limit in the audit log and the notices sent. Back as Priya: **Resume run** finishes. |
| 12 | Dev · Plan | **Try this** on Cheapest fit → **Change now** → **Undo** | "Plan fit replays the last 90 days." | Three-window replay, sliders for Data Credits and Actions, monthly/annual, proration, effective date, protected terms; the undo banner refunds in full. |
| 13 | Brain · Clock | Payment states: **Renewal fails, no backup** → Dev · Billing | "A failed card is a soft landing." | Banner on every tab, retry timeline, credits still working until the grace date, export always available. Then **Grace window ends unpaid**: runs pause, exports don't. **Update card and retry** recovers. |
| 14 | Dev · Plan | **Cancel subscription** → "Credits run out too quickly" → **Take this** (rollover bonus); again → "It costs too much" → **No thanks, cancel** | "Cancelling is as easy as subscribing." | Honest summary of what expires; matched offers; the cancel button always one click away. Brain · Clock shows both answers as exit surveys. **Keep my subscription** undoes it. |
| 15 | Header | Tenant → **BuilderCo**, then **APICo** | "Config, not code." | Different meters, thresholds (75/90/100, 50/80/100), pause policy (freeze), Spark (or none), starter pack, coupons and teams, same Hub. |

## Known gaps (Phase 2)
- Playwright journeys live in `tests/journeys/`; Playwright isn't an app dependency, so run them with an available Playwright (`npx -p playwright node tests/journeys/run.mjs`).
- Earlier cycles in the usage explainer and plan fit are replayed from each persona's workflows; only the current cycle is on the live ledger.
- Waiting runs resume at the next renewal when the Brain clock crosses it; there is no notification e-mail beyond the simulated notices log.
- Share links work in the browser that made them (data is stored locally).
- The new Hub composites (estimator, run panel, payment health, cancel flow) are shown in the Hub itself and exercised by the journeys; they are not yet separate entries in the component gallery.
- Spark and badge credit amounts are fixed by the pack until Phase 5 puts them under experiments.
- Prices, tax, provider names and benchmarks are illustrative.
