# Export notes

This is a source copy of the Monetization Cockpit concept prototype (Master Brief and Phases 1–8), exported from Microsoft App Builder on 24 Nov 2026.

## What was changed for this copy

- Removed the App Builder platform settings files, which held the Microsoft environment, app and repository IDs.
- Removed the App Builder agent guidance file.
- Renamed the browser storage keys from the App Builder app ID to `monetization-cockpit:`.

Nothing else was changed. The code matches the published app.

## Before you push

- Make the repository **private**. This is a Microsoft work product about Chargebee and Clay; get your manager's OK and follow Microsoft's open-source/IP release process before you make anything public.
- All data in the app is simulated sample data. The integrations (billing, MCP, agents, evals) are simulated too.

## Running it outside App Builder

`package.json` depends on Microsoft App Builder platform packages (`@microsoft/managed-apps`, `@microsoft/rayfin-*`, `@microsoft/managed-apps-common`). These may not be installable from the public npm registry. If they are not, `npm install` / `bun install` will fail and the app will not build outside App Builder without removing those dependencies and the few files that import them (`src/connectors/inline-agent.ts`, `src/lib/connector-policy-monitor.ts`, `src/lib/query-cache.ts`).

If the install works:

```
bun install        # or npm install
bun run dev        # or npm run dev
bun test tests/    # unit tests
```

## Where to start reading

- `README.md`: project overview
- `CHANGELOG.md` and `DECISIONS.md`: what was built per phase and why
- `docs/demo-scripts/12-minute-demo.md`: the leadership demo walk-through
- `docs/known-gaps.md` and `docs/risk-register.md`: known limitations
