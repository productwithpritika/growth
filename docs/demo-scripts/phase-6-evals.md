# Phase 6 · Bring Your Own Evals: what to click

Start from **Reset demo**, tenant **Clay**, horizon **Run**, persona **Nia**, Workbench → **Evals**. About 8 minutes.

| # | Where | Click | What to say | What they see |
|---|---|---|---|---|
| 1 | Model right-sizing (opens first) | — | "Clay defaults every prompt to the most expensive model. We prove which cheaper model is just as good." | Company research: Frontier L 92, Balanced M 91 at 38% of the cost, Compact XS 84 at 9%. One sentence recommends Balanced M, inside the 2-point margin. |
| 2 | Impact panel | Drag the scenario slider from 40% to 0%, then 100% | "Cheaper runs can lower revenue per task while improving retention and margin." | Credits saved per run, spend per workspace, margin per credit, run-out share, and net revenue and gross profit this month and over 12 months move together. |
| 3 | Impact panel | **Create experiment** | "One click puts it on a cohort, with quality guardrails." | Experiments opens on "Balanced M as the default for Company research" for Paid · buys top-ups, with user-reported quality and rerun rate guardrails. |
| 4 | Skill picker → **Find work email** | Model right-sizing | "Not every skill can go cheaper." | Keep Frontier L: Balanced M is 5 points lower and contact-data accuracy fails. |
| 5 | **Create experiment**, then Experiments | Request approval is disabled | "The gate blocks a launch on a failing skill." | "Quality gate failed for Find work email on Balanced M…" |
| 6 | Quality gate | Write a reason → **Request override** → **Review** → **Approve override** | "Overrides need a reason and an approver, and they're audited." | The override is listed; the experiment now shows "launch allowed by an override approved by…". |
| 7 | Runs and results | **Run eval** | "Each run is its own synthetic tenant. Nothing touches production." | `sbx-clay-…` mirrors plans, meters and limits; eval credits are charged; leaderboard with intervals, suites matrix, the cost–quality frontier with the Pareto line, side-by-side examples and failure clusters. **Explain** opens Ask CB. |
| 8 | Runs and results → Rubric | Change a weight → **Save rubric** → **Run eval** | "Your rubric, your definition of quality." | Scores move with the rubric; repeats show the spread. |
| 9 | Skills → **Register a skill** | **Fetch** → **Validate** | "Bring your own skill." | Side effects, no idempotency and a 45 s timeout fail. Apply the three fixes, store a key (only a fingerprint is kept), **Run a test call**, **Register**. |
| 10 | Data | Upload a CSV, or **Generate synthetic** with 40 rows | "Bring your data; we mask it on the way in." | Masked columns, region, retention, **Delete dataset**, and a warning under 100 rows. |
| 11 | Regression watch | **Simulate a provider change** (Balanced M, −6), then Time machine **+1 day** | "When a provider changes a model, we re-evaluate and tell you." | A scheduled re-eval, a drift chart with the change marked, an alert routed to Ask CB; a running Balanced M experiment pauses on its canary. |

## Known gaps
- Scores are simulated per example (deterministic); no skill endpoint is called. The wizard's fetch and MCP connection return example manifests.
- The four seeded skills and model tiers are the same on every tenant.
- The judge calibration figure (91% agreement on 40 labels) is fixed, not computed.
