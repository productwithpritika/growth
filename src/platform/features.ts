// Which roadmap horizon a feature belongs to (pure, so non-UI code can read it). Crawl: billing
// basics and the ledger. Walk: forecasts, designed moments, plan fit and growth tooling. Run:
// agents, MCP, evals and AI.
export type HorizonId = "crawl" | "walk" | "run";
export const RANK: Record<HorizonId, number> = { crawl: 0, walk: 1, run: 2 };

export const FEATURE_HORIZON = {
  "hub.home": "crawl",
  "hub.usage": "crawl",
  "hub.tables": "walk",
  "hub.lifecycle": "walk",
  "hub.cheaperModel": "run",
  "hub.topups": "crawl",
  "hub.billing": "crawl",
  "hub.forecast": "walk",
  "hub.moments": "walk",
  "hub.limits": "walk",
  "hub.rewards": "walk",
  "hub.plan": "walk",
  "hub.assistant": "walk",
  "wb.start": "run",
  "wb.today": "crawl",
  "wb.hypotheses": "walk",
  "wb.plays": "walk",
  "wb.breakage": "walk",
  "wb.rewards": "walk",
  "wb.economics": "crawl",
  "wb.overview": "walk",
  "wb.experiments": "walk",
  "wb.churn": "walk",
  "wb.optimiser": "walk",
  "wb.ask": "run",
  "wb.onboard": "run",
  "wb.controls": "run",
  "wb.evals": "run",
  "wb.mcp": "run",
  "wb.agents": "run",
  "wb.experiences": "run",
  "wb.embed": "walk",
  "wb.packs": "walk",
} as const satisfies Record<string, HorizonId>;

export type FeatureKey = keyof typeof FEATURE_HORIZON;

export function atHorizon(horizon: HorizonId, key: FeatureKey): boolean {
  return RANK[horizon] >= RANK[FEATURE_HORIZON[key]];
}
