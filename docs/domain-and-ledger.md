# Domain model and ledger rules

## Entities (Phase 1 §1.4)
Types live in `src/core/domain.ts`; Brain → Domain model counts each one for the active tenant.

| Group | Entities | Lives in |
|---|---|---|
| Tenancy | Tenant, Workspace, User | Tenant Pack; population; personas |
| Pricing | Plan, Meter, Offer, RewardRule | Tenant Pack |
| Ledger and usage | CreditGrant (plan · rollover · topup · reward · promo, expires at), LedgerEntry, Hold, UsageEvent, Table, Enrichment, ModelChoice | Ledger, event stream, population |
| Growth | Cohort, Hypothesis, Experiment, Variant, Scorecard, Recommendation | Store and derived reads |
| AI quality | SkillEndpoint, EvalSuite, EvalRun | Population |
| Operations | Notification, ApprovalRequest, AuditLog, ChatTicket | Event stream, store, population |

## Ledger rules (§1.5)
All in `src/core/ledger.ts` (pure functions over an append-only array) and `src/core/forecast.ts`.

- **Kinds:** grant, debit, hold, release, rollover, expiry, reversal. Corrections are reversals (`reverseEntry`), never edits.
- **Every entry:** id, idempotency key, reason code, actor, plus the hash of the entry before it.
- **Spend order:** reward and promo → plan and rollover by nearest expiry → top-ups (`compareLots`).
- **Holds:** `placeHold` reserves; `settleHold` (or a run against its hold) releases the difference or debits the excess, and always closes the hold.
- **Never negative:** `Book.post` refuses anything below the tenant's floor (`ledgerPolicy`); metering returns a typed `BlockReason`, rendered by `blockMoment()`.
- **Renewal:** `renew` closes plan and rollover lots and opens one rollover lot up to the rule's cap.
- **Forecast:** `forecastRunOut` — trailing 7-day burn, weekday weights, run-out date with an 80% band.

## Checks
`src/core/checks/` holds the acceptance suites. Run them in Brain → Checks, or:

```
bun test tests/
```
