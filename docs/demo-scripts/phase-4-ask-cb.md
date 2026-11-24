# Phase 4 · Ask CB: what to click

Start from **Reset demo**, tenant **Clay**, horizon **Run**. About 8 minutes.

| # | Who · where | Click | What to say | What they see |
|---|---|---|---|---|
| 1 | Nia · Ask CB | **Which cohorts are at risk and why?** | "Answer first, then evidence." | Auto chose CB Deep and says why; a cohort table, evidence, confidence, Memory cards used, next-action chips, "Used 1 CB credit". Turn on **Show my work** for the tool calls. |
| 2 | Ask CB | Type **/** | "Slash commands are the power path." | Autocomplete with arguments; `/cohort ` shows argument chips and a preview line. **/scorecard** with a running experiment embeds the live scorecard. |
| 3 | Ask CB | **/grant dev 25** | "Every write goes through approval." | The ApprovalSheet with preview, diff, risk and estimated cost; Approve posts a promo grant and writes the audit with this conversation's id. **/undo** reverses it, also behind approval. |
| 4 | Ask CB · Autonomy | Credit grants → **Auto within budget**, then **/grant dev 20** | "Autonomy is per workflow and bounded." | Auto-approved within today's 50-credit budget; **/grant dev 500** still asks. |
| 5 | Ask CB | **Research analyst** on, ask "How do usage-priced AI tools design top-ups and free tiers?" | "A research analyst that shows its plan." | Sub-questions, a brief with citations into the Growth Knowledge Base (marked illustrative), **Save to Playbook**. Costs 3 CB credits. |
| 6 | Ask CB | Keep asking until credits run out | "CB Daily 5 is Chargebee's own allowance." | The empty moment: wait until tomorrow, use CB Lite (free short answers), or add 20 CB credits. Launching with guardrails or recording a learning earns bonuses. |
| 7 | Ask CB · Autonomy | Failure drill → **Timeout**, then ask anything | "Failures have specific copy." | "The cohort query took longer than 20 seconds…" and nothing charged. Set it back to None. |
| 8 | Any screen | **⌘K**, type **/credits** | "Ask CB is everywhere." | The drawer opens and answers. On Crawl only /credits and /help are offered. |
| 9 | Maya · header | **Assistant**, ask "What's Dev's balance?" | "End users get the same engine with narrower tools." | A polite refusal naming no one; **/credits** shows her own balance and forecast. |
| 10 | Nia · Ask CB · Records | **Run the 10 attempts** | "Red-teamed scope." | 10 of 10 held. Below it: the audit log with conversation ids and slash commands versus clicks. |
| 11 | Ask CB | Microphone | "Voice, with text always available." | Live transcript, a short spoken answer, details on screen. Voice cannot approve. Where the browser blocks the microphone, it says so and typing works. |

## Known gaps
- The scripted library matches patterns; unusual phrasings decline with suggestions unless the live model fallback is on.
- Knowledge Base cards are illustrative patterns written for the prototype, not sourced research.
- CB credit purchases are simulated (no payment).
