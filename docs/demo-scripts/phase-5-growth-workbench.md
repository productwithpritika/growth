# Phase 5 · Growth Workbench: what to click

Start from **Reset demo**, tenant **Clay**, horizon **Run**, persona **Nia** (Sam for finance). About 12 minutes.

| # | Where | Click | What to say | What they see |
|---|---|---|---|---|
| 1 | Today | Any tile | "What's true today, and where it comes from." | MRR movements, credit burn, top-up attach, breakage share, margin per credit by model, funnel, voluntary versus involuntary churn; each tile opens its cohort or the ledger. |
| 2 | Cohorts | Free · quiet before a first enrichment; slice by **Region** | "Who's at risk, who's thriving, and why." | Risk score with three plain drivers, the retention heatmap by signup week, what thriving workspaces do differently with effect sizes. **Save as audience**, **Revenue at stake**, **Nudge toward thriving behaviours**. |
| 3 | Hypotheses | **Pick this one** on #1 → **Approve and launch** | "A daily experiment, recommended with a reason." | Observation, hypothesis, effect range, metric, audience, intervention, guardrails, effort, risk, confidence. Launching earns CB credits. |
| 4 | Experiments | Open the new experiment | "Built like a pricing team would." | Holdout, MDE and sample size, layer, pre-registered metrics, guardrails with stop-loss, sample-ratio check. |
| 5 | Time machine | **+1 day** | "A stop-loss in action." | "Win-back at 40% off" pauses itself: gross margin breached its guardrail. Kill it or resume with a wider guardrail. |
| 6 | Time machine | **+3 days**, then **+3 days** | "D1 never declares a winner; D7 decides." | D1 Too early, D3 Directional with intervals, D7 Ship / Hold / Kill with intervals and segment cuts. |
| 7 | Experiments | **Ship to 100%** → **Approve and ship**, then **Revert** | "Shipping needs approval and keeps a revert." | Shipped, the learning lands in the library, the audit trail shows approve, launch and ship. |
| 8 | Experiment plays | **Use this play** on one | "Twelve plays with priors, not promises." | Prior ranges from the simulator; the dashboard shows in flight, win rate, cumulative impact and learning velocity. |
| 9 | Churn arrest | Retry timing → **Smart retries**, then **Dunning Rescue: draft actions** | "Involuntary churn is recoverable." | Recovery rate moves; the agent drafts one action per account for approval. |
| 10 | Plan optimiser | **Run … as a sandbox**, pick a grandfathering policy, **Then test it on new customers only** | "Personas, replayed, then tested safely." | Revenue, margin, conversion and churn per variant; the grandfathering impact; a draft experiment for new customers only. |
| 11 | Sam · Breakage pool | 1,500 accounts × 2,000 credits → **Fund from the pool** | "Breakage funds growth, within finance's rule." | Refused with the numbers. Lower it and it funds; nudges cost nothing. The finance note asks to confirm accounting treatment. |
| 12 | Rewards studio | Save "Log in every day"; then **A/B test it** on the draft rule | "Good behaviour is rewarded; low-value behaviour never is." | The login rule is refused; the draft becomes an experiment that ships into the Tenant Pack and reverts. The abuse monitor flags burst domains. |

## Known gaps
- Two simulated populations coexist: the Growth layer reads the 90-day simulator (scaled 25×); Unit economics and the lower parts of Churn arrest and Plan optimiser read the billing sample. They are labelled; unifying them is Phase 8 work.
- Conversion and churn shifts in the plan optimiser are model estimates; revenue and margin come from the replay.
- The cheaper-model play is flagged as needing evals until Bring Your Own Evals (Phase 6).
- Breakage accounting is illustrative and says so.
