# The 12-minute demo, with presenter notes

Open the app, **Reset demo**, then **Present** (Alt+Shift+P) and start the timer. Alt+Shift+N moves to the next moment, Alt+Shift+B goes back, Alt+Shift+F fast-forwards one simulated day. Each moment below is a button in presenter mode; it switches persona, tenant and screen for you.

The prototype is a concept with illustrative data: say so once at the start. Every number is computed from the Tenant Packs and a seeded simulation; no real payment, personal data or third-party logo is used.

| Time | Moment | Do | Say |
|---|---|---|---|
| 0:00 | Roadmap: what ships first and why | Point at the three lanes, then the flags table. | "This is a portfolio, not a feature list. Small things ship daily inside guardrails, bigger ones every two weeks with sign-off, headline launches quarterly. Every module has a maturity tied to the Horizon toggle and its own kill switch." |
| 1:00 | Credits Hub: Dev is running low | Show the forecast and the top-up moment. | "This is what Clay's paying customer sees: one balance, a forecast with a range, and a designed moment before they run out, not after." |
| 2:30 | Credits Hub: Maya on Free | Show the activation moments and rewards. | "For a free user the job is activation: the first enrichment, Daily Spark, then the upgrade moment at the cap." |
| 3:30 | Agentic onboarding and tour | Connect, let it run, show the reveal. | "Clay connects its data; the agent reads it, asks five questions at most, and has a first experiment ready in minutes." |
| 4:30 | Ask CB | Ask "Why do quiet free users leave?" | "Answers come with evidence and the tool calls behind them. Every write goes through an approval." |
| 5:30 | Experiment lab and stop-loss | Fast-forward one day. | "A deep win-back discount paused itself on margin. Nothing ships without guardrails." |
| 6:30 | Evals: model right-sizing | Slide the scenario; Create experiment. | "Clay defaults to the most expensive model. Balanced M scores 91 against 92 at 38% of the cost. Cheaper runs lower revenue per task, but fewer customers run out and margin rises; here's the net." |
| 7:30 | Evals: the quality gate | Show Find work email failing; mention the audited override. | "Evals are the gate: a cheaper model that fails can't be launched without a reason and an approver." |
| 8:15 | MCP Console and constraints | Call grant_reward with 80. | "Every capability is a governed tool. The cap is 50, so the agent is refused. Writes always need an approver." |
| 9:00 | External agent | Ask "Can I run this table…?", then "Turn on auto top-up". | "Any AI client can use the portal with a scoped token. Reads answer instantly; billing changes wait for a person." |
| 9:45 | Agents and the kill switch | Run the Experiment Operator; flip the kill switch. | "Nine agents with clear autonomy. One switch stops them all." |
| 10:30 | Custom portal experience | Describe a moment, preview, publish, roll back. | "Merchants build portal experiences in plain words, versioned and reversible." |
| 11:15 | Embed SDK | Open Credits as a drawer, then Hosted. | "And it lives inside Clay's own product." |
| 11:45 | Product health and close | Show the north star, then Portfolio. | "We run the portal on its own metric tree: value from monetization moments per active account, with guardrails on complaints, refunds and margin." |

## If something goes wrong
- **Reset** in presenter mode puts everything back, dated today.
- A toast that says "Not saved in this browser" means storage is blocked; the demo still works for the session.
- If an experiment already shipped in a previous run-through, use Reset before starting.

## Pitch mapping
| Presentation question | Where it is shown | Moment |
|---|---|---|
| How is the portfolio managed, what ships first, later, why | Roadmap and Portfolio | Roadmap |
| How does the portal support credit pricing and monetization moments | Credits Hub, Moments, Plan Fit, Top-ups | Credits Hub: Dev |
| How is a free user activated and converted | Lifecycle lens, Rewards, experiments | Credits Hub: Maya |
| What MCP tooling is supported, especially for custom experiences | MCP Console, Portal Experience tools, Moment definitions | MCP Console |
| How are agent workflows incorporated | Agents page, Ask CB, agentic tour, approvals | Agents |
