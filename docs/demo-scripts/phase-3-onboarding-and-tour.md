# Phase 3 · Agentic onboarding and the tour: what to click

Start from **Reset demo**, tenant **Clay**, horizon **Run**, persona **Nia**. About 8 minutes.

| # | Where | Click | What to say | What they see |
|---|---|---|---|---|
| 1 | Get started | Nothing | "Chargebee asks before it reads anything." | Six sources with why, what is read, what is stored, retention, scopes and the data region. The three Chargebee-native sources are on; connectors are off. Turning one off shows what the agent won't know. |
| 2 | Get started | **Failure drills for the demo** (optional) | "We designed the bad days too." | Help chat fails, analytics is slow or partial, invoices in a region with no policy pack. |
| 3 | Get started | **Connect and start learning**, then speed **12×** | "Real progress, on Clay's data, in front of you." | Seven lanes move through reading and understanding with live counts and learned chips; Memory cards fill in; the Time to first experiment clock starts. |
| 4 | Lanes | Answer the chips (VAT rule, Solo is a proposal, Data Credits, 14 days) or **Skip** | "At most five questions, each skippable." | The answer updates its Memory card to high confidence and is logged. |
| 5 | Memory cards | **Edit** one, **Forget** "Never run an enrichment" | "Every fact has a source and can be forgotten." | The reveal hides the finding that depended on it and says why. **Restore** brings it back. |
| 6 | Reveal | Read the five findings | "Your monetization, in one view." | Evidence, an impact range labelled Estimate, and an Explore link on each. |
| 7 | Reveal | **Launch your first experiment** | "Do, don't show: the agent drives the real Workbench in a sandbox." | The dock narrates each step; Cohorts opens, the at-risk free cohort is selected, Ask CB answers with three ranked hypotheses, the recommended one is picked, a draft appears with holdout and guardrails, the scorecard layout previews. |
| 8 | Dock | **Pause**, **Take over**, **Hand back**, **Replay** (or Alt+P/T/R) | "You're in control at every step." | Taken-over steps are marked "you"; voice narration and reduced motion are switches. |
| 9 | Approval sheet | **Approve and launch** | "The launch is the only live change, and only Nia can approve it." | The experiment is running in Experiments; the dock shows Time to first experiment (typically 3–5 minutes simulated). |
| 10 | Get started | **Journey analytics** | "We measure the onboarding itself." | Sessions reaching each tour step, steps taken over, the latest events with simulated time. |

## Known gaps
- Connectors are simulated: connecting, slow, failed and partial are scripted states, not real integrations.
- Real speech and the live model depend on the browser and the frame; both fall back to text and the scripted library.
- The tour's highlight follows the side navigation; on phones it highlights the content instead of the menu.
