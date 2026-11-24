# Decisions

Architecture decisions for the Monetization Cockpit concept prototype. Newest last.

## D1 · Folder layout maps the Phase 1 brief onto `src/`
The brief lists `/apps/cockpit/{core,tenants,sim,agents,mcp,surfaces,ui,mocks}`. App code must live under `src/`, so each folder is `src/<name>`:

| Brief | Here | What it holds |
|---|---|---|
| core | `src/core` | ledger (hash chain), metering, forecasting, economics, insights, actions |
| tenants | `src/tenants` | Zod Tenant Pack schema, registry, the three packs, personas |
| sim | `src/sim` | seeding, day-by-day simulator with renewal, population, series, pack preview |
| agents | `src/agents` | LLM gateway, Ask CB context, onboarding agent |
| mcp | `src/mcp` | mock MCP tool registry with traced calls |
| surfaces | `src/surfaces/{credits-hub,workbench,brain,gallery}` | the screens |
| ui | `src/ui` | the 12 documented components plus tone, primitives, horizon |
| mocks | `src/mocks` | request handlers for `/api/...` routes |

`src/components` keeps the shell (top bar, nav, ⌘K palette, demo script, theme toggle) and the locked platform components.

## D2 · Tenant Packs are JSON validated by Zod at runtime
`src/tenants/registry.ts` loads every `packs/*.json` with `import.meta.glob` and runs `parsePack()`: a Zod shape check plus cross-reference checks (plan/meter/rate-card ids). A pack that fails is kept out of the tenant switcher and its issues show in Brain → Tenant Pack. Every Brain edit and every onboarded or pasted pack goes through the same function.

## D3 · Personas are global, not per pack
Maya and Dev (Credits Hub) and Nia and Sam (Growth Workbench) exist for every tenant. Each pack supplies their demo accounts (`demo.hub`) and merchant role names (`demo.merchantRoles`). The persona switcher picks the surface; there is no separate `/workbench` route.

## D4 · Ledger semantics
Entry kinds: grant, rollover, debit, hold, release, top-up, reward, expiry, adjustment. Lots carry `expiresAt`; debits consume lots FIFO by expiry. Holds reserve credits for in-flight runs and are released when the run is metered. Every entry hashes the previous one; Brain → Credit ledger re-verifies the chain.

## D5 · Grant rules replace per-meter rollover
Grants are `(plan, meter)` rules with `*` as the fallback: monthly or daily cadence (daily may carry a monthly cap), rollover none/capped (×allowance)/full, optional expiry days. Top-ups are packs (units, price, validity days) instead of a per-meter premium, so BuilderCo's 12-month packs and APICo's deposit amounts are expressible.

## D6 · Demo clock and simulator
A seeded tenant sits on day 23 of a 30-day cycle. `advanceDay()` settles holds, runs the day's schedule (auto top-ups included), posts daily grants, and at day 30 renews: expiry, rollover caps, plan changes and the invoice charge. Brain → Clock drives it.

## D7 · Mocks are in-process handlers, not MSW
The `msw` package isn't available in this build environment. `src/mocks/handlers.ts` uses the same `http.get/post(path, resolver)` shape and `mockFetch()` serves them in-process against the current tenant state. Swapping to MSW later means registering the same handlers with a service worker.

## D8 · AI goes through one gateway
`src/agents/llm-gateway.ts` is the only code that reaches a model (the app's inline agent connector). Ask CB and onboarding use it. Deterministic work (scaffolding, validation, simulation, risk, diff) is labelled "tool" in the agent narrator; nothing scripted is presented as AI. The model keeps no memory, so each call carries its context.

## D9 · Onboarding needs a person's approval
The onboarding agent drafts a pack, tools scaffold demo data, validate (one AI repair round) and simulate, and an ApprovalSheet shows preview, diff, rule-based risk and an audit id. Only approval loads the tenant; approvals and rejections are recorded on the tenant with the same audit id shown in the sheet.

## D10 · Horizons gate features, they don't fork code
Crawl: hub usage, top-ups, billing; workbench unit economics; Brain; gallery. Walk adds forecasts, moments, limits, rewards, plan fit, cohorts, experiments, churn and the optimiser. Run adds Ask CB, onboarding and MCP controls. `src/ui/horizon.ts` holds the map.

## D11 · Brand accent stays inside the white-labelled hub
The cockpit chrome keeps one accent (rose). A tenant's accent from its pack applies only inside the Credits Hub (`data-brand` scope), because that surface is what the tenant's customers see.

## D12 · No "illustrative data" banner in the app
The brief asks for a "Concept prototype, illustrative data" banner. The hosting platform doesn't allow sample-data banners inside apps, so the note lives in the demo scripts and in conversation instead. Every number is generated from the packs and a seeded population.

## D13 · Storage
All state lives in this browser's local storage (schema version 3). Older data is upgraded by re-seeding the ledger from the packs and carrying over experiments, save plays and hub limits; a tenant loaded at runtime keeps its own pack if it still validates.

## D14 · Seven entry kinds; grant sources carry spend order
Ledger entries are `grant`, `debit`, `hold`, `release`, `rollover`, `expiry` and `reversal`. What used to be separate `top-up`, `reward` and `adjustment` kinds are grants with a `source` (`plan`, `rollover`, `topup`, `reward`, `promo`). Every entry has an id, an idempotency key (posting a key twice returns the first entry; reusing it for a different amount is refused), a reason code and an actor (`system:scheduler`, `user:maya`, `merchant:nia`, `agent:…`). The hash covers all of them.

## D15 · Spend order and lots
Credits are spent reward and promo first, then plan and rollover credits nearest expiry, then top-ups (ties by age). `lotState()` replays an account's entries to know what is left in each lot; expiries name the lot they remove, and releases and reversals give credits back to the lots they came from.

## D16 · Holds release the difference
A hold reserves the estimate. When the job finishes it runs against the hold: whatever the hold covers is not debited again, any excess is a debit, and a `release` of the unused difference (possibly zero) closes the hold. Usage reads debits, holds and releases together, so a settled hold counts exactly its actual cost.

## D17 · Rollover is close-and-reopen
At renewal every plan and rollover lot closes with an `expiry` (`expiry.cycle-close`) and one `rollover` grant reopens what the rule allows (none, capped at ×allowance, or full). Rewards, promos and top-ups keep their own dates. It costs a few more entries than carrying lots silently, but the carry and the loss over the cap are both visible.

## D18 · Never negative, and blocks are typed
`Book.post()` refuses any entry that would take a balance below the tenant's floor (`ledgerPolicy`: zero by default, or a capped overdraft). Metering checks first, so runs stop or block rather than throw; the result carries a `BlockReason` (`insufficient_balance`, `budget_reached`, `channel_cap`, `tier_cap`, `subscription_paused`, `plan_feature`). `blockMoment()` turns any reason into MomentCard content, and the Hub shows the latest non-balance block as a moment with the action that clears it.

## D19 · Forecasts are weekday-weighted
`forecastRunOut()` learns weekday weights from the cycle's history (shrunk toward a B2B prior until there is enough of it), takes a weekday-neutral rate from the trailing seven days, and projects day by day with an 80% band that widens with √t. Confidence is high with 14+ days of history and a steady burn, medium from 7, low below.

## D20 · The 90-day population is separate from the personas
Maya and Dev stay hand-authored stories on the live ledger. The population is a second, seeded simulation of ~2,000 workspaces for 90 days (workspaces that signed up before the window carry history from signup so cohorts have months 1–3). Each workspace has its own seeded stream, so a behaviour change moves only the workspaces it touches. It aggregates per day instead of posting 2,000 ledgers. A run saves its config, hash, totals and cohort tables with the tenant; the rest is recomputed from the seed and checked against the saved hash.

## D21 · Pack-driven enrichments, outcomes and models
What a workspace runs (enrichments with their rate-card step, outcome mix and models) comes from the pack's `demo.sim`. A model listed first is the default; a model can bill to a different rate-card item (Clay's research models) or only change provider cost (BuilderCo). A pack without `demo.sim` gets a mix derived from its rate card, so packs loaded at runtime still simulate.

## D22 · Region packs, money and prompts
`src/tenants/regions/{us,eu,in}.json` are validated like Tenant Packs. Packs keep pricing in net US dollars; a region converts (illustrative rate), applies its tax display (EU VAT-inclusive, India GST-exclusive, US sales tax by address) and decides when a card payment needs strong authentication (EU 3-D Secure from €30, India OTP always, US none). Each Hub account has a billing region; the Hub wraps itself in a `MoneyProvider` so its components format money for that region while merchant views stay in dollars. Card payments go through `usePay()`, which shows the simulated prompt (no card data or codes are collected) and logs `payment.authenticated` or `payment.auth_cancelled`. Auto top-up needs recurring-payment consent per region; without it automatic charges pause.

## D23 · One set of acceptance checks, two runners
The checks are plain functions in `src/core/checks/` with a tiny harness. Brain → Checks runs them in the browser; `tests/acceptance.test.ts` runs the same suites under `bun test tests/` (packs read from disk because the runtime pack loader is a bundler feature).

## D24 · Tables are workflows plus one estimator table
Clay's tables map to each persona's workflows (rows = units, columns = steps) plus one table from the pack (`demo.hub.<persona>.table`, 4,200 rows for Dev, Maya's 150-row list) for the estimator. Hub runs are `TableRun` records: one enrichment column over a table, row by row, each row's outcome seeded from the run id so a demo replays the same way.

## D25 · Holds in the Hub: hold the high end, draw first, release the rest
Confirming a run holds the upper end of the estimate (capped at the balance). Rows draw from the hold first; anything beyond it is debited as `usage.over-hold`; finishing or pausing posts one release for what the hold didn't use. Consumption stays −(hold + release) + debits, so the ledger rules from Phase 1 are unchanged. Hub runs manage their own holds; the scheduler's settle step leaves them alone.

## D26 · A pause is a state, not an error
Running out of credits, reaching a blocking limit or an unpaid renewal after grace pause the run at the next row with a typed reason. Every recovery resumes the same run (new segment, new hold) from the next row. "Wait for reset" parks it and the renewal resumes it. "Run smaller" trims the run; trimmed rows are never run or charged.

## D27 · Maya's mid-run moment is seeded, and reproducible live
The seeded cycle already has Maya's weekly list stopped for credits on day 15 (16 Nov); the seed turns that into a paused run at row 43 of 150. Adding any column to her table hits the cap again live. Both recover the same ways.

## D28 · Roles drive the Hub, the Member persona is a teammate
A fifth global persona, "Member", plays the teammate flagged `persona: true` in the pack's team (Priya on Clay). It works in Dev's account with the Member role. The role matrix (`core/team.ts`) decides which sections and actions show; changing a role in Limits changes what that persona sees at once.

## D29 · Requests approve by raising the limit and topping up only the shortfall
Approving a Member's request raises their blocking limit by the amount and, if the workspace balance doesn't cover it, buys a top-up for the shortfall on the card on file (with backup fallback). Notices are simulated: an e-mail per approver, a team-chat post when chat is on, and an in-app card.

## D30 · Thresholds use what was available this cycle
80/90/100% compare usage with everything available this cycle (allowance, carry-in, rewards, top-ups), the same base as the balance card, so a top-up moves the needle and the copy never says more than 100%.

## D31 · Auto top-up: cap behaviour, failure handling and changing your mind
At the cap, "stop" halts automatic top-ups and "ask" records a request the admin can allow with one tap (raising the cap by exactly one pack). On a failed charge, "backup" charges the backup method, "retry" tries again the next day, "pause" stops and tells the admin. "I changed my mind" pauses for 7 days or turns it off, and refunds the last automatic top-up only if it is under 24 hours old and its lot is untouched (a reversal entry, charge marked refunded).

## D32 · Plan fit replays demand, not what got through
The 90-day replay uses demand (every requested row) in three 30-day windows ending today: the current cycle from the event stream, earlier cycles replayed from the same workflows and rate card (free accounts stop at their allowance, as they did). A combination "runs out" in a window when its allowance falls short and top-ups aren't allowed; the cheapest fit includes top-ups, never-runs-out doesn't. Expansion blocks per meter come from the pack (`hub.expansion`).

## D33 · Plan changes: upgrades now, downgrades at renewal, 24-hour undo
Upgrades take effect now with a prorated charge and prorated grants; downgrades and cheaper annual moves are scheduled for renewal. Undo within `hub.undoHours` reverses the prorated grants (refused, with the reason, if they were already spent) and marks the charge refunded. Existing paid terms are never repriced.

## D34 · Daily Spark and badges follow behaviour, and are bounded
A day qualifies when a run of at least `spark.minRows` rows returns verified results (from contact columns with `verifiedShare`). The grant is source `reward`, reason `reward.spark`, 7-day expiry, up to the cycle cap. Badge credit amounts default to zero and are left to Phase 5 experiments. Every grant passes one wallet per verified domain and daily/weekly velocity limits; refusals are recorded with the rule.

## D35 · Dunning: soft landing first, runs pause only after grace
A failed renewal tries the default card, then the backup. Unpaid, the account enters a grace window (`hub.dunning.graceDays`) with retries on `retryDays`; credits keep working. After grace, new runs pause with `payment_overdue`; usage, invoices and exports stay available. A card update retries at once. Renewals now go through this path, and Brain → Clock → Payment states puts an account into each state.

## D36 · Cancel reasons are data
Reasons map to optional offers (`OFFERS_FOR` in `core/hub-actions.ts`): too expensive → downgrade or own key; credits run out → auto top-up or a rollover bonus (funded by breakage); not using → pause or a guided template; accuracy → a support review. Each outcome (accepted, cancelled with the offer shown, kept) is stored on the tenant as an exit survey for the Workbench.

## D37 · Provider names are invented
Marketplace providers in the usage explainer (Northwind Data, ProfileGraph, Mailwise waterfall, Dialpoint) are illustrative names, not real vendors.

## D38 · The Growth layer reads the population simulator, scaled
Phases 3–5 need region, source, activity and model behaviour per workspace, which the 90-day population simulator has and the billing sample (Unit economics) does not. The simulator runs a 2,000-workspace sample; counts and money in the Growth layer are multiplied by `pack.growth.sampleScale` (25) so experiments have realistic reach. The billing-sample views stay where they were and say so. Unifying the two populations is left for Phase 8.

## D39 · Onboarding runs on simulated seconds
Ingestion advances in simulated seconds at a chosen speed (1–12×); from the reveal onwards the Time to first experiment clock runs at real speed. Lanes, chips and counts are computed from the tenant's data, so "real progress" means the numbers on screen are the numbers the Workbench uses. Questions are capped by `growth.assistant.maxQuestions` (5).

## D40 · The tour's sandbox lives on the tour
While the tour runs for a persona, Workbench writes land on a sandbox (experiments, Ask CB threads, audiences) stored on that persona's tour. Anything else a sandbox write touches (pack, ledger, Hub accounts, CB credits) is discarded. The only live write is the approved launch, which copies the sandbox draft into the live lab. Every step completes on a condition (tab open, cohort selected, answer received, hypothesis picked, draft present, preview opened, approval requested, launched), whoever made it true; that is how take-over works.

## D41 · Ask CB is scripted and computed, with an optional live fallback
The default provider is deterministic: intents are matched by pattern and every answer is computed from the live tenant state, so numbers match the screens and tests can assert them. Unmatched questions decline with suggestions; with "Scripted, then live model" they go to the app's inline agent with the cockpit snapshot. CB credits are charged only for answered questions (not for declines, clarifications or empty results). End-user threads are free and Sandbox answers cost nothing.

## D42 · End-user scope is enforced before intent matching
A Credits assistant message that names another persona or teammate, asks about customers, workspaces or cohorts in general, uses a merchant-only command, passes an account to /credits, or tries an injection phrase is declined before any tool runs. The decline names no one and shows no numbers.

## D43 · Experiments draw outcomes from a hidden truth
Each experiment's true lift is drawn deterministically from its prior (keyed by the hypothesis or play), and each simulated day draws exposures and outcomes for control and variant from that truth with a conversion lag. Verdicts: D1 Too early, D3 Directional, D7 Ship / Hold / Kill on the 95% interval and the guardrails. The stop-loss pauses on a guardrail breach that has enough data and is beyond noise (margin: 3 points; counts: limit and 3 standard errors).

## D44 · Breakage funds new promotional credits at list value
The pool is forecast breakage × the funding rule, minus what is committed this month. Upsell credits are valued at list price for the check, expire in `growth.breakage.promoExpiryDays` (7), and are new grants, never transfers. Nudges cost nothing. The finance panel says to confirm the accounting treatment.

## D45 · Shipping can change the Tenant Pack, and reverting restores it
An experiment may carry pack patches (for example a reward rule). Shipping applies them; Revert restores the previous values. Other interventions ship as a 100% rollout record. Both are audited.

## D46 · Eval scores are simulated per example, with the seeded scenario pinned
Each run draws a score per example, model and repeat from a difficulty term and noise (deterministic for the run), then centres each model's mean on its target. Intervals, the paired difference against the default model, the spread between repeats and failure clusters are computed from those per-example scores, so they behave like real statistics (smaller datasets give wider intervals). The targets are pinned so Company research reads 92 / 91 / 84 at 100% / 38% / 9% cost. Model names (Frontier L, Balanced M, Swift S, Compact XS) are invented tiers.

## D47 · Non-inferiority uses the whole interval
A cheaper model passes only if the lower end of the 95% interval of its paired difference stays above −margin. If the mean is inside the margin but the interval crosses it, the gate warns ("not proven"); if the mean is outside, it fails. Hard suites (schema compliance under 97%, contact-data accuracy under 92%, refusals under 90%) fail on their own. A dataset under 100 rows, or a provider change after the last run, turns pass into warn. The recommendation is the cheapest model that passes.

## D48 · The impact model is a scenario, and it says so
Monthly runs come from the cohort that burns credits fastest (Paid · buys top-ups). Cheaper models bill fewer credits per run (a quarter of the default plus three quarters scaled by cost), so margin per credit rises. The slider sets how much of the saving users spend on more runs: at 0% revenue per task falls and fewer run out mid-month; at 100% revenue holds and the gain is margin. Retention assumes workspaces that run out mid-month churn 12 points more often. Net revenue is the revenue change plus retained revenue; the 12-month view accumulates retained accounts.

## D49 · One gateway for every caller, and writes always have an approver
People, Ask CB, agents and external clients call tools through `invoke`, which checks token, tenant, kill switch, agent switch, server scope, tier, rate limit, account scope, input constraints and idempotency before anything runs. Reads run; drafts create drafts only; writes go to approval, or run under a standing budget a person approved (recorded as the approver). Dry runs execute on a copy and discard it. Arguments, prompts and results are masked before they are logged.

## D50 · Rate limits use simulated time for daily agent runs
Agents triggered by the Time machine pass the simulated clock as their call time, so a week of simulated runs is not throttled in one real second. Console, Ask CB and external client calls use wall-clock time.

## D51 · Agents act on scripts and structured fields only
Agent scripts choose tools from state (balances, scorecards, provider changes), never from text they read. The Trust page's injection tests put instructions into help chats, pasted text, dataset rows, tool output, a Moment prompt and a CSV and check that no write happens. Ask CB removes long quoted passages and anything after "help chat:", "dataset:", "tool output:" or "email:" before intent matching, and says it read pasted text as data.

## D52 · Moments are content plus a link, never money
The composer only produces a Moment definition (trigger, audience, content, primary action, frequency cap, experiment hook, locales, version). If the words ask for a grant, refund or discount, it says those are separate tools with their own approval. Preview shows the latest version to the merchant regardless of the trigger; published versions show to customers when the trigger holds, and a dismissal hides it for the frequency-cap window. Rollback replays publishes as a stack.

## D53 · The embed is simulated in the page
The snippet is the real integration shape (web component, modules, mode, theme, SSO token, event hooks). In the prototype, the mock tenant app renders the same React modules in a drawer or modal, which is what the component would do; no script is served from a CDN and no iframe is used.

## D54 · Feature flags live on the tenant; maturity stays global
Maturity (Crawl, Walk, Run) is fixed per module and tied to the Horizon toggle. Rollout percentages and kill switches are per tenant state, so a kill on Clay does not affect APICo. A killed module is hidden from navigation; the portfolio marks modules that depend on it as blocked. Rollout percentage is shown, not simulated per visitor.

## D55 · SeatCo prices seats through its plans
The pack schema has no per-seat price. SeatCo's plan prices and pools are stated for the demo team size (8 seats) and the plan highlights say "$12 per seat · priced here for 8 seats". The archetype field is informational; billing behaviour comes from the existing fields.

## D56 · Phase 6–8 surfaces write to the live tenant
Evals, MCP, agents, experiences, embed and the Pack Builder are outside the agentic tour, so they write to the live tenant even while a tour sandbox is active for the Phase 3–5 loop.

## D57 · Sliders on the new screens are native range inputs
The shared slider component does not name its handle for assistive technology and is a protected file, so Phase 6–8 screens use a native `<input type="range">` labelled by its visible label.
