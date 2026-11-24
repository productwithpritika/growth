# Phase 7 · MCP tooling, agents, experiences and embed: what to click

Persona **Nia**, tenant **Clay**, horizon **Run**. About 8 minutes.

| # | Where | Click | What to say | What they see |
|---|---|---|---|---|
| 1 | MCP Console → Servers and tools | Credits → `grant_reward` | "Every capability is one governed tool, for people, our agents and anyone's AI." | Eight servers, 35 tools with Read, Draft or Approval tiers, the tool input editor: amount max 50, expiry default 7 days. |
| 2 | Try it as a token | **Call grant_reward** (Dunning Rescue, amount 80) | "Constraints change what an agent can send." | Refused: the maximum is 50. Raise Max to 100 and call again: it waits for approval. |
| 3 | Approvals and activity | **Approve**, then **Explain this action** | "No write happens without an approver." | Executed with the approver recorded; the explanation in plain words; masked arguments in the log. |
| 4 | External agent demo | **Can I run this table with the credits I have?** | "An external AI client with a scoped token." | `get_balance` then `estimate_run_cost` in the ToolCallTrace, and a plain answer. |
| 5 | External agent demo | **Turn on auto top-up**, then **What's Maya's balance?** | "Writes route to approval; other accounts are invisible." | set_auto_topup needs approval (approve it right there); Maya's balance is refused. |
| 6 | Clients, tokens and budgets | **Create scoped token** | "Least privilege by default." | A token shown once, then only its fingerprint; standing budgets for Auto within budget. |
| 7 | Agents | **Run Experiment Operator now** | "Nine agents, each with a trigger, an autonomy level and a metric." | The run timeline as a ToolCallTrace; pending approvals; credits granted today. |
| 8 | Agents | Flip the **Global kill switch** | "One switch halts every agent." | Every agent shows Halted; Run now is disabled. Flip it back. |
| 9 | Portal experiences | Keep the example words → **Save as a draft moment** → **Preview in Credits Hub** | "Merchants describe an experience; the agent builds it." | The Moment JSON next to a plain summary, and a live preview for Dev and Maya. |
| 10 | Portal experiences | **Ask to publish v1** → **Approve and publish**; change "5 days" to "10 days" → **Draft v2** → publish | "Versioned, approved, live." | v2 fires for Dev now. **Open Credits Hub as Dev** shows it. **Roll back** returns to v1. |
| 11 | Embed SDK | **Credits** in the mock app; switch Modal and Hosted | "The hub inside Clay's own app, not an iframe." | Balance, top-ups and plan modules in a drawer or modal; event hooks fire; the hosted page shows the same modules. |

## Known gaps
- Tokens, the MCP connection and the CDN script are simulated; no network calls are made.
- Agents are scripted: they choose tools from state, not from a model.
- Rollout percentages are displayed and drive status; they are not sampled per visitor.
