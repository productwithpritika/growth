# Known gaps

What the concept does not do yet, across all phases.

## Data and simulation
- Two simulated populations: the Growth layer reads the 90-day simulator (scaled 25×); Unit economics and parts of Churn arrest and Plan optimiser read the billing sample. Both are labelled.
- Eval scores are simulated per example; no skill endpoint, model or MCP server is called. The judge calibration figure is fixed.
- The four seeded skills and model tiers are the same on every tenant.
- Product health inputs are computed from the simulation; the refund rate is illustrative.
- SeatCo's per-seat prices are expressed through plan prices for an eight-seat team.

## Integrations
- Tokens, the MCP client connection, the manifest fetch and the embed CDN script are simulated; nothing leaves the browser.
- Agents are scripted; Ask CB is scripted with an optional live-model fallback.
- Data is stored in this browser only.

## Quality bar
- Accessibility: automated checks run on the Phase 6–8 screens in the journeys; a full manual screen-reader pass has not been done.
- Performance budget not met on a phone profile. Production build, Credits Hub interactive: desktop 1.2 s warm, 2.6 s cold; 4× CPU with a 4G network: 9.6 s warm, 16.7 s cold (budget 2.5 s). The app ships as one 2.4 MB script (720 KB gzipped) compiled up front. Next: split by surface (Workbench, Brain, gallery, program pages) and load the simulator on demand.
- Visual regression: screenshots are captured during journey runs but no baselines are compared.
- Pseudo-locale stretches Tenant Pack strings (names, labels, copy); interface copy is English only.
- The brief asks for a "Concept prototype, illustrative data" banner on every screen; the hosting platform does not allow it (D12), so the demo scripts say it instead.
