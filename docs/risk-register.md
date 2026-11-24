# Risk register

Risks for taking the concept to a real build. Likelihood and impact are High, Medium or Low.

| # | Risk | Likelihood | Impact | Mitigation in the concept | Next step |
|---|---|---|---|---|---|
| 1 | Customers distrust run-out forecasts that are wrong | Medium | High | Forecasts show a range and a confidence; moments say "at your current pace". | Back-test forecasts on real usage before showing ranges to customers. |
| 2 | An agent grants money or changes billing without consent | Low | High | One gateway; writes need an approver or a standing budget; input caps; kill switches; audit with prompt and approver. | Security review of the gateway; signed approvals. |
| 3 | Prompt injection through help chats, datasets or tool output | Medium | High | Untrusted text never selects tools; Ask CB strips pasted content; injection tests run in the product. | Red-team with real transcripts; add model-level guards when a live model is used. |
| 4 | Eval results don't match production quality | Medium | High | Non-inferiority on the whole interval, minimum dataset size, canary evals and stop-loss after launch. | Calibrate the judge against more human labels per skill; shadow traffic. |
| 5 | Cheaper default models reduce revenue | Medium | Medium | The scenario slider shows the trade-off; launches go through an experiment with guardrails. | Finance sign-off on the revenue assumptions. |
| 6 | Breakage-funded grants are accounted for incorrectly | Medium | Medium | Funding rule enforced; the finance panel asks to confirm treatment. | Finance and audit review of breakage recognition. |
| 7 | Regional rules (tax display, recurring-payment consent) are missed | Medium | High | Region packs; Pack lint flags billed regions without tax rules; Policy Sentinel. | Legal review per region before launch. |
| 8 | Tenant data leaks across tenants or accounts | Low | High | Tokens bound to a tenant and optionally an account; isolation tests in the product. | Penetration test; per-tenant encryption keys. |
| 9 | Demo data mistaken for real figures | Medium | Medium | Demo scripts say illustrative; numbers come from a seeded simulation. | Keep "illustrative" in every external deck. |
| 10 | The release cadence outpaces enablement | Medium | Medium | Tier gates: Tier 2 sign-offs, Tier 1 launch review, enablement kit and beta. | Release calendar with Customer Success. |
| 11 | The portal is slow on mid-range phones | High | Medium | Measured: 9.6 s to an interactive Credits Hub at 4× CPU on 4G (budget 2.5 s). | Code-split by surface, lazy-load the simulator, server-render the Hub shell. |
