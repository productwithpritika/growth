# Monetization Cockpit · Chargebee next-generation portal (concept)

A clickable concept prototype of Chargebee's next-generation monetization portal for AI-native companies, with Clay as the launch tenant. Illustrative data only: every number comes from the Tenant Packs (`src/tenants/packs/*.json`) and a seeded simulation. No real payment, personal data or third-party logo is used.

## Run it
- **Published app**: open the app link shared from the App Builder. Data is kept in your browser; **Reset demo** restores the seeded state, dated today.
- **Locally**: `bun install`, then `bun run dev` and open the printed URL.
- **Tests**: `bun test tests/` (unit and acceptance checks for Phases 1–8).
- **Journeys** (Playwright): `APP_URL=http://localhost:5173/ node tests/journeys/run.mjs` for Phase 2, `PHASE=345` for Phases 3–5, `PHASE=678` for Phases 6–8.
- **Checks**: `bun run check` (type-check, build dry run, lint).

## Find your way
- **Personas** (top bar): Maya and Dev see the Credits Hub; a Member sees Dev's workspace; Nia (growth) and Sam (finance) see the Growth Workbench.
- **Tenants**: Clay, BuilderCo, APICo and SeatCo, one per pricing archetype, plus any you load from the Pack Builder or Onboard a tenant.
- **Horizon**: Crawl, Walk, Run shows the roadmap stage of every module.
- **Present** (Alt+Shift+P): presenter mode with named moments, fast-forward, reset and the 12-minute timer.

## Docs
- `docs/demo-scripts/12-minute-demo.md`: the presenter script with notes and the pitch mapping.
- `docs/demo-scripts/phase-*.md`: what to click for each phase.
- `DECISIONS.md`, `CHANGELOG.md`, `docs/risk-register.md`, `docs/known-gaps.md`.

---

# App Builder Template

A React + TypeScript + Vite template for in-session mini-apps built by an AI agent inside the App
Builder. It ships **shadcn/ui (new-york, Radix)** + **Tailwind CSS v4** and a small, familiar set of
libraries — no heavy state/form/validation frameworks — so an agent can build a polished app fast and with
few surprises.

## Stack

- **React 19** + **TypeScript** + **Vite 7** (run with **bun**)
- **shadcn/ui** (`new-york`) on **Radix** primitives (the unified `radix-ui` package)
- **Tailwind CSS v4** (CSS-first, no JS config — tokens live in `src/index.css`)
- **react-router-dom 7** for routing
- **TanStack Query 5** for async data, **TanStack Table 8** for grids
- **zustand** for global state (only when needed; `useState` for local)
- **recharts** for charts, **@dnd-kit** for drag & drop, **lucide-react** for icons, **sonner** for toasts
- **Leaflet**, used by the `maps` add-on's protected `SpatialMap` control for
  connector-backed interactive maps without app-owned map credentials. Its
  public, provider-independent API supports stable-id marker collections,
  controlled app-owned selection, center/zoom/bounds commands, and plain
  viewport events.
- **html2canvas-pro 2.4.2 + jsPDF 4.2.1**, used by the `pdf` add-on's export button for bounded Canvas-style PDF capture of an app-owned screen or container, including modern CSS colors and a small backdrop bleed that preserves rounded edges and shadows (`unpdf` remains the existing-PDF extraction tool); the button bounds connector-neutral follow-up callbacks so a stalled save cannot wedge export
- **@microsoft/managed-apps** — the connector runtime for an app that carries a
  data-source binding (Dataverse, SharePoint, Excel, Office 365, SQL, …). The
  name is an npm alias of `@microsoft/cmr-apps`, so the codegen's
  `@microsoft/managed-apps/data` imports and the template's own imports load
  one SDK copy.

## Scripts

| Script | What it does |
|--------|--------------|
| `bun run check` | Type-check (`tsc`) + Vite build dry-run + ESLint — the required gate before commit |
| `bun run typecheck` | Type-check only (`tsc -p tsconfig.app.json --noEmit`) — the cheap gate the app-builder agent runs before hand-back |
| `bun run lint` | ESLint only; this template's config ignores `public/`, which Vite serves as-is (the pre-deploy gate passes `--ignore-pattern public` for an app with an older config) |
| `bun run dev` | Vite dev server (managed externally by the runtime — do not run by hand) |
| `bun run build` | Production build (`vite build`) — no type-check |
| `bun run preview` | Preview a production build |

## Project layout

```
src/
  App.tsx        routes + providers
  main.tsx       entry point
  index.css      Tailwind + design tokens (oklch)
  routes.tsx     route + nav manifest (add a page here)
  components/    app-shell, error-boundary, confirm-dialog, states, page-section + ui/ (shadcn, pre-installed)
  hooks/         reusable hooks (use-mobile, use-confirm)
  lib/           cn(), query-client, store (zustand), safe-url, console capture, Cowork parent transport
  pages/         route-level screens (home, not-found)
  types/         fixed parent-frame message contract
generated/       typed connector client, present only when the app carries a binding (do not edit)
```

The map (`maps`) and PDF (`pdf`) controls are optional add-ons in `templates/aether-app-addons/`: a
new app has none of their files until `add-component <name>` copies them in.

Path alias: `@/` → `src/`.

## Agent instructions

The build/iterate rules an agent needs at the per-app level — stack conventions, the Tailwind v4
cheat-sheet, structure, and a one-line Capability controls list (each control's full how-to lives in the App
Builder skill, so it stays current after the app is created) — live in **[AGENTS.md](./AGENTS.md)**, with the
OKLCH presets in its sibling **[THEMING.md](./THEMING.md)** (read on a turn-1 build or recolor/restyle). The file
format is agent-agnostic — any coding agent (Claude Code, Codex, Cursor, …) reads these, and there is
intentionally no `CLAUDE.md`. Within the App Builder, the subagent that builds and iterates apps is
additionally governed by its own always-loaded operating rules — the verification loop and the full "what
not to touch" ban list — which are enforced there and deliberately **not** duplicated into this `AGENTS.md`
(so this per-app file is intentionally not a self-sufficient contract for an external agent running outside
the harness). Both files are size-gated by `scripts/lint-claude-md-size.py` (rows and remedy in its `BUDGETS`
table); over budget, move a capability's how-to into the App Builder skill's `references/agent/` rather than
raising the row.

## Live data

An app that carries a data-source binding has its typed client in `generated/` and its
connection reference in `ms.config.json`; the app-data-connectivity skill governs how the agent
consumes them. Both are managed only by the runtime's typed `appbuilder-DataSourceAdd`,
`appbuilder-DataSourceRefresh` and `appbuilder-DataSourceRemove` tools (a connector's actions, or one
table of any tabular connector — SharePoint list, SQL table, Dataverse table; only a SQL stored
procedure as a data source is not offered) — never by a command in this image or by hand. A
request that explicitly requires Spatial Services, Azure Maps, live map tiles or geocoding stops without generating app code when no
binding can be obtained; any other unbound geographic map is an ordinary app map component under
the same map bans. For any other source the app is
not bound to and cannot bind, the agent builds with realistic sample data, identifies each affected
dataset or entity as sample-backed in authoring chat only, and adds no sample/demo/mock/test-data
provenance copy or UI treatment to the app.

## Notes

- This template is **in-memory by default** — a refresh resets app state.
- `node_modules/` is baked into the orchestrator image and bind-mounted read-only; dependencies are not
  installed or patched per session.
