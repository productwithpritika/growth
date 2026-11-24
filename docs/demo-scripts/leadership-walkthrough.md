# Leadership walkthrough (about 15 minutes)

Before you start: **Reset demo** (top bar), tenant **Clay**, horizon **Run**, persona **Maya**.

| # | Persona · where | Say | Show |
|---|---|---|---|
| 1 | Maya · Credits Hub → Usage | "Maya is on Free. Her Data Credits ran out a week ago; today her only path is Launch at $185." | The ran-out moment, the balance card, the burn forecast. |
| 2 | Maya · Top-ups | "With the Cockpit she can buy a pack instead of jumping a plan." | Pack cards; buy one; the balance updates and the ledger gets a top-up entry. |
| 3 | Dev · Usage | "Dev runs a team on Growth. The forecast shows when each meter runs out, with an 80% range." | Two balance cards, held credits from the in-flight ABM run. |
| 4 | Dev · Billing | "His auto top-up was declined: the card expired. Replace and retry." | Payment-failed moment → Billing → update card → retry; credits land. |
| 5 | Dev · Limits | "No surprise bills: monthly cap, alerts and per-workflow budgets." | Set a budget on one workflow. |
| 6 | Nia · Cohorts | "Merchant side. One in four Free accounts hit a cap this cycle." | Usage map, cohort list, draft a test from a cohort. |
| 7 | Nia · Experiments | "Every test has a hypothesis, a metric and lift with a 95% interval." | Open the running experiment. |
| 8 | Nia · Ask CB | "Ask CB answers from the same brain. Each question uses AI credits." | Ask "Which cohort should we test next?" |
| 9 | Nia · Onboard a tenant | "Onboarding a new AI company is an agent job with a human gate." | Fill an example brief → Draft with the agent → watch the plan, tool calls and simulation → approval sheet with diff, risk and audit id → Approve. |
| 10 | Sam · Unit economics | "Finance sees margin per credit and the breakage pool." | Margin table, rollover slider. |
| 11 | Dev · Top-ups, Billing region → India, then European Union | "Billing follows the customer's region." | Rupees with GST added, then euros with VAT included; Buy opens the one-time-password or 3-D Secure prompt with the tax breakdown; auto top-up asks for a new consent (an e-mandate in India). |
| 12 | Brain → Credit ledger | "Everything above is one append-only, hash-chained ledger. Every entry has a reason, an actor and an idempotency key." | Spend order panel; Grant promo credits to Maya and watch them go first; Reverse a debit; Verify chain. |
| 13 | Brain → Clock | "Move the clock: holds settle and release the difference, schedules run, lots expire, renewal rolls plan credits over up to the cap." | Advance 7 days, then to renewal. |
| 14 | Brain → Population | "2,000 workspaces over 90 days from a fixed seed. Three in four AI research runs stay on the most expensive default model." | Weekday pattern, outcomes, model choice with evals, cohort tables by signup month and plan. |
| 15 | Brain → Help chats | "Twenty-five conversations where customers ask for free credits or discounts, tagged by intent." | Filter Free credits; open one. |
| 16 | Brain → Checks | "And the proof: ledger rules, forecasts, simulator determinism, tenant switching and region rules, all passing." | 26 of 26; the gallery's 59 states. |
| 17 | Tenant switcher → BuilderCo, then APICo | "Same cockpit, different business models, configured only by a Tenant Pack." | Maya's hub for each. |
| 18 | Horizon toggle | "Crawl, Walk, Run is the roadmap: the same build with features gated by horizon." | Switch to Crawl, then back to Run. |

If AI is slow or unavailable at step 8 or 9, use **Take over → Start from the template** in onboarding; the narrator then marks the draft as yours, not the agent's.
