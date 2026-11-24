# Phase 8 · Scale, release cadence, hardening and demo mode: what to click

About 6 minutes. **Present** (or Alt+Shift+P) opens presenter mode at any time.

| # | Where | Click | What to say | What they see |
|---|---|---|---|---|
| 1 | Roadmap and flags | — | "The cadence is part of the product." | Daily, fortnightly and quarterly lanes with templates and gates; start a Tier 3 release and it rolls out at 10% without sign-off; Tier 2 waits for product and finance. |
| 2 | Roadmap and flags | Kill **Experiment lab** | "Every module has a maturity and a kill switch." | Experiments disappears from the Workbench; restore it. |
| 3 | Portfolio | — | "What ships first, later and why." | Impact versus effort, the dependency map, and the sequence; with the lab killed, Evals and Agents show Blocked. |
| 4 | Product health | — | "Our own metric tree." | North star, seven inputs and three guardrails with eight-week trends, and the event taxonomy. |
| 5 | Trust and security | **Run isolation tests**, **Run injection tests** | "Help chats, datasets and tool outputs are data, never instructions." | 6 of 6 and 6 of 6 pass; PII masking live; consent ledger; retention with Delete now; audit export. |
| 6 | Pack Builder | Seats plus a credit pool; switch on **Allow a negative balance** | "The portal generalises; lint catches risky packs." | The Credits Hub preview reconfigures; lint flags the uncapped overdraft; set a cap and **Load as a new tenant**. |
| 7 | Tenant switcher | BuilderCo, APICo, SeatCo | "Same journeys, four archetypes." | Hub, Evals, MCP and the external agent work on each; APICo's lint flags Japan's missing tax rules. |
| 8 | Presenter mode | Pseudo-locale on | "Long translations don't break layouts." | Plan names and labels stretch about 40%. |

## Known gaps
- No visual-regression baselines are stored; screenshots are taken in the journey runs instead.
- The performance budget is not met on a phone profile: 9.6 s to an interactive Credits Hub at 4× CPU on 4G (warm), against 2.5 s. See docs/known-gaps.md.
- Product health inputs come from the simulated population; refunds are a fixed illustrative rate.
