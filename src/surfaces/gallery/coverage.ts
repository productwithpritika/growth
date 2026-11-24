// The states the component gallery renders for each component. The gallery draws one tile per
// entry and the Brain's Checks tab reports the coverage.
export const GALLERY_STATES: Record<string, string[]> = {
  MeterBar: ["Plenty left", "Held and expiring", "Running low", "Empty", "Compact"],
  CreditChip: ["Each meter", "Signed debit", "Signed credit", "Zero"],
  BalanceCard: ["Lasts the cycle", "Runs out early", "Ran out", "Compact"],
  ForecastLine: ["Lasts the cycle", "Runs out early", "Ran out"],
  LedgerTable: ["Full", "Dense", "With reverse", "Empty"],
  MomentCard: ["Forecast (at risk)", "Payment failed (blocked)", "Expiring (watch)", "Reward", "Disabled action with hint", "Run blocked · insufficient_balance", "Run blocked · budget_reached", "Run blocked · channel_cap", "Run blocked · tier_cap", "Run blocked · subscription_paused", "Run blocked · plan_feature"],
  ApprovalSheet: ["Low risk", "Medium risk", "High risk"],
  AgentNarrator: ["Working", "Failed step", "Taken over", "Finished"],
  ScoreCard: ["Populated", "No signups"],
  CohortHeatmap: ["Weekly retention", "No cohorts"],
  HypothesisCard: ["Draft", "Running", "Shipped", "Stopped"],
  ToolCallTrace: ["Calls", "Error and running", "No calls"],
  PaymentPrompt: ["EU 3-D Secure", "India one-time password", "Card check"],
  RecurringConsent: ["United States", "European Union", "India over the mandate limit", "Not ticked (error)"],
  RenewalDisclosure: ["United States", "European Union", "India"],
};

export const GALLERY_STATE_COUNT = Object.values(GALLERY_STATES).reduce((s, x) => s + x.length, 0);
