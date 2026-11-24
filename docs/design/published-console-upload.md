# Authoring-only console uploads

**Status:** Implemented

## Problem and scope

Published apps currently attempt to POST browser diagnostics to an authoring-only
endpoint. This fixes bic/app-studio#3881 for newly created apps, and for existing
apps through the existing-app refresh, which rewrites a stale `console-capture.ts`
(lair task 3b3d). Fleet rebuilds and republishing are excluded: an app published
before the fix keeps its old build until it is rebuilt.

## Current architecture

`src/lib/console-capture.ts::postToDevServer` is the shared uploader for
`console.error`, global errors, unhandled rejections and
`src/lib/console-capture.ts::reportPrivateRuntimeError`.
`vite-dev-reload.ts::devReloadSSE` registers the receiver only during Vite serve;
it sanitizes and appends reports to `.browser-errors.log`.
Console forwarding and the fixed host crash signal are separate channels.
`src/main.tsx` imports capture before the app graph to observe pre-render errors.

## Requirements

1. Built apps issue no authoring-console requests from any of the four emitters,
   including builds with inherited `NODE_ENV=development`.
2. Authoring still uploads sanitized diagnostics with the actual `hmr: false`
   configuration, including errors before the first React render.
3. Preserve original console calls, the fixed host crash message, private-error
   isolation, deduplication and receiver behavior. Parent console forwarding
   follows the same serve-only boundary: a built app forwards no console line,
   and an authoring app forwards only to an origin in `CONSOLE_PARENT_ORIGINS`
   (lair task 3b3d).
4. Introduce no public API, configuration, dependency or production endpoint.

## Options and tradeoffs

- **DEV-only guard:** small, but the remote Power Platform build environment is
  unknown and Vite builds can inherit `NODE_ENV=development`.
- **Preview URL/base guard:** recognizes hosted preview paths but excludes local
  authoring and couples diagnostics to routing conventions.
- **Selected: existing `import.meta.hot` metadata:** Vite supplies a hot context
  to served browser modules even with native HMR disabled, and replaces it with
  `undefined` in builds independently of `NODE_ENV`. Return from the shared
  uploader before deduplication when that context is absent. This intentionally
  relies on Vite; the container suite checks its real serve/build transforms,
  while the manually run browser matrix checks the complete template integration.

## Scale and telemetry

The guard removes upstream diagnostic work from built apps and adds no upstream
work. Authoring keeps its existing deduplication and bounded receiver. Native
console output and fixed host crash messages remain unchanged. Parent console
forwarding runs only while authoring and only to an audited Cowork origin; no
production telemetry channel is added or redirected.

## Model and tool impact

Not applicable: no model selection, tool schema, tool description or registration
changes.

## Validation

Extend the source-executed contract fixture with explicit hot metadata through
supported transformation tooling, preserving its wire payload. Focused Bun tests
exercise all emitters with and without that metadata, console calls and parent
message isolation. `console-vite-contract.test.ts` runs in the existing Bun
container suite: it serves the real capture module through Vite with `hmr: false`
and checks Vite's hot-context injection, then builds that module under both
`NODE_ENV` values and checks that the uploader endpoint is absent while native
reporting remains; the browser matrix checks that a built app posts no console
line to its host. It uses the template's installed Vite, without
defining or stubbing `import.meta.hot`.

The manually run Playwright test runs the real Vite serve integration with
`hmr: false`, verifies sanitized receiver output and pre-render capture, and
executes actual built apps in a browser for both production and development
`NODE_ENV` values. Zero-request assertions must also prove the emitters ran.

## ADR — serve metadata rather than environment mode

**Decided by: AGENT**, within the explicitly requested template-owner maintenance.
The actual remote build environment is unknown; a DEV-only guard cannot establish
the required production silence. Use Vite's existing serve-only hot context,
whose build replacement does not depend on that environment. Keep the decision
bounded by real Vite transforms in the existing container tier and the manual
dev/build browser matrix, rather than only metadata supplied by unit fixtures.
The uploader's serve-only boundary does not change the existing camera bridge
or other lifecycle predicates; those features require their own host contracts
and are outside this diagnostic-upload fix.
