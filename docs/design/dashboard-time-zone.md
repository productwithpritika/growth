# Dashboard Local / UTC display
**Status:** Accepted (implemented by #79627 and #83139)

## Problem and current architecture

Issue #68112 requests a visible Local/UTC choice for timestamp dashboards.
`dashboard-time-range::customTimeRange` already stores fixed UTC instants;
`filter-bar::TimeRangeFilter` interprets and presents them locally.
`dashboard-charts::{formatXValue,xValueZone,trendTable}` supplies the shared
chart, tooltip, accessible-table and export paths. `useUrlFilters` owns validated
URL state. Calendar filters and `dashboard-data::inRange` have whole-day
semantics, not exact timestamp-window semantics.

Source semantics are not interchangeable. Dataverse UserLocal is an instant,
DateOnly is a calendar date, and TimeZoneIndependent is a wall-clock value even
when its wire representation ends in Z. App Builder's current Dataverse schema
projection does not expose DateTimeBehavior; SharePoint's broad DateTime type
does not establish date-only display semantics. This change must not invent
metadata or infer those distinctions from midnight values.

Production dashboard usage and correctness denominators are unmeasured.
Generic crash telemetry cannot establish the absence of wrong dates.

## Testable requirements

1. Timestamp dashboards offer Local and UTC, with an always-visible
   `Local (browser zone)` or `UTC` selection beside Copy link in the header.
   This is the single dashboard-wide indicator, not a caption under each chart.
   Calendar-only dashboards omit the picker.
2. The mode is a validated URL string (`local` default, `utc` alternative).
   Sharing UTC reproduces clock presentation; Local uses the recipient's zone.
3. Fixed ranges retain exactly the same instants across switches. Elapsed
   presets retain their duration. Changing presentation does not rebucket
   source/UTC bins; client-side calendar grouping of instants (every
   DrillBreakdown time level) follows the selected zone.
4. An explicitly offered timestamp-calendar preset such as Today, Yesterday or
   This month resolves boundaries in the selected zone and is visibly labeled.
   Its query key includes that zone; this intentional filter change can change
   rows. Date-only calendar filters remain unchanged.
5. Custom inputs, axes, tooltips, summaries, accessible chart tables, exports and
   authored timestamp cells agree. Day-bin labels remain source calendar labels.
   Preaggregated totals disclose their source reporting zone separately.
6. Nonexistent local times are rejected. Repeated local times offer an explicit
   occurrence choice; unchanged endpoints preserve their original instant.
   UTC input has no DST ambiguity. Fractional-offset zones are supported.
7. Date-only and wall-clock values never shift. Authors explicitly declare field
   semantics using confirmed source metadata; unknown semantics are not promoted
   to an instant by examining a suffix. Missing/invalid values remain explicit.
   Undeclared values keep legacy handling with two exceptions: a valid bare
   `yyyy-MM-dd` (a `bucketByTime` bucket) is a date, and an offsetless
   date-time is shown as written in UTC mode and exported as written.
8. Existing dashboards retain Local behavior until deliberately upgraded.
   Older app snapshots are not automatically rewritten.
9. A reproducible finite browser matrix covers CSV, SharePoint, Kusto, SQL and
   Dataverse contracts, both modes, multiple browser zones and boundary cases.
   An HTML evidence report links screenshots and identifies live, replay and
   deterministic-domain evidence separately. A blocked live target is not a pass.

## Options

| Option | Benefits | Costs |
| --- | --- | --- |
| Reformat axis ticks only | Small diff | Contradictory inputs, tooltips, tables and filters |
| Explicit mode and temporal semantics in shared primitives | Consistent, backward-compatible, testable | Requires authored propagation and metadata discipline |
| Automatic per-connector conversion and arbitrary named-zone selection | Broad automation | Missing metadata, larger public tool/API surface, unsafe inference |

Use the second option. Arbitrary zone selection, remote schema-tool enrichment,
automatic migrations and reaggregation of already-binned results are out of scope.

## Approach

Add a pure `dashboard-time-zone` module exporting `DashboardTimeZone`
(`local | utc`), `TemporalKind` (`instant | date | wallClock`), URL validation,
a visible zone label and a shared temporal formatter. Reuse the public `TZDate`
export from the already-declared `react-day-picker` dependency for UTC date-fns
formatting and calendar arithmetic; do not implement a date-fns token parser or
use a shifted native Date whose local DST rules corrupt UTC fields.

Add a controlled `TimeZoneFilter` with a required `hasTimestamps` declaration.
Pages persist the value using `useUrlFilters`, put the control beside
CopyLinkButton, and pass the mode to time controls, charts, `DashboardHeader`
and authored cells. The header forwards it to its absolute freshness tooltip;
elapsed freshness retains its existing meaning.
Keep the selector compact; its selected option names the mode without a second
caption. Controlled charts do not repeat zone footers or ordinary tooltip
suffixes. Local tooltips spanning different DST offsets retain their per-value
abbreviations to distinguish repeated clock times. Standalone legacy charts
without a supplied dashboard mode keep their existing zone context.
Per-card PNG exports add each chart's zone in the capture clone only, because the
global header is outside that image; the live dashboard stays uncluttered.
No global mutable context or connector-result duplication is introduced.

Extend time-range options with the selected zone and optional calendar presets.
The same options object drives picker, validation and query helpers. KQL bounds
remain UTC; ordinary KQL bin duration and source/UTC bin membership do not
change, while client-side calendar grouping of instants (DrillBreakdown time
levels) follows the selected zone. A declared `instant` re-zones date-only and
offsetless cells there as on TrendChart, so such a source states its offset in
the cell or declares `date`/`wallClock`. Day bins and warehouse period keys
keep their own reading, and a declared `date`/`wallClock` spelling TrendChart
leaves blank ("Mar 1, 2026") still buckets in the drill as it did before kinds
were declared. Query keys include the mode only when calendar-boundary resolution
actually depends on it. Exact timestamp membership is separate from the
existing whole-calendar-day `inRange` contract.
Calendar timestamp queries use half-open bounds so adjacent days cannot share
midnight. Existing fixed/elapsed KQL predicates retain their inclusive bounds.
Preset admission uses a zone/clock-independent full-period cap budget, shared by
URL validation, picker and query resolution. This month requires 31 calendar
days of budget, not the current month-to-date elapsed duration.

Chart props explicitly carry the mode and temporal kind through shared helpers.
Calendar-day bins are exempt. Raw exported instants remain unambiguous and
offset-bearing; exports of dates and wall-clock values retain their semantics.
Operational freshness keeps its elapsed meaning and labels any absolute time.
Numeric temporal axes require an explicit temporal kind; otherwise existing
numeric category/hour labels remain unchanged. Non-instant string parsing must
preserve literal fields or reject the representation, never convert through
the viewer's zone.

## Scale and failure boundaries

Formatting is browser-local and linear in rendered values; bounded existing
bucket allocation remains unchanged. Reuse formatters where practical rather
than allocate unbounded per-row state. DST candidate discovery is bounded to
offset changes around a selected day, not the complete time-zone database.
There are no new actors, Redis keys, network requests or concurrency boundaries.
No connector credentials, user data or zone selections are added to telemetry.

## Model-facing surface

N/A: no model-facing tool, runtime route, SSE payload or connector HTTP parser
changes. Authoring references explain the new scaffold helpers and require
confirmed source semantics. No assertion is made that current schema discovery
automatically supplies Dataverse behavior or SharePoint date-only metadata.

## Test strategy and data adequacy

Frontend data verdict: ADEQUATE for explicit typed temporal operations, from the
existing exact calendar/Excel/DST/URL corpus and official contracts below.
These are domain inputs, not fabricated HTTP response bodies. Live transport
and field classification remain a separate measured matrix.

Use Bun integration/component tests over real shared helpers, URL navigation,
picker input, DST gap/fold choices, calendar boundaries and chart output.
Run the existing chart, drill and UTC-part lint neighbors, TypeScript checks,
lint and production check build. Real Chromium contexts exercise rendered
charts, filter interaction, reload/sharing and narrow viewport layout.
Mutation controls must demonstrate that reverting mode propagation or field
exemptions fails exact observable assertions.

The browser report enumerates its scenario population before execution and
records a verdict and evidence source per row. Screenshots are taken after
observable assertions; visual appearance alone is not correctness evidence.
Live connector probes read existing business sources only; synthetic test
data lives in a dedicated list on a verified test site. Corporate payloads and
screenshots are not published unless reduced to safe temporal fields.
Unavailable browser or connector targets are explicit blockers, never
substituted identities or synthetic live results.

Rust wiremock, actor propagation and cross-runtime fixture gates are N/A to this
frontend-only change; the two relevant tiers are component integration and a
real served browser. Any expansion into runtime/tool parsing reopens that scope.

## Observability

Use existing app error handling and validation messages. No backend entry point,
session scope, task or log schema changes. The test report captures explicit
failures and browser errors without customer content. Production date
correctness remains unmeasured; no telemetry query is claimed to prove it.

## Decision records

### ADR-001: Browser-local sharing

- **Context:** Local display cannot reproduce a sender's zone for another viewer.
- **Decision:** Local means recipient-local; UTC shares identical clock values.
- **Rationale:** User selected: "Recommended: Local means each viewer's browser
  zone; UTC links reproduce the same clock times. Preserve source calendar bins
  and label their source zone; never pretend relabeling changes aggregation."
- **Alternatives considered:** Pin sender zone (requires named-zone scope);
  presentation-only UTC (omits requested Local behavior).
- **Decided by:** USER
- **Rollback lever:** Revert the new opt-in mode props and header control.
- **Consequences:** Local links preserve instants, not identical clock labels.

### ADR-002: Explicit upgrades and DST occurrence choices

- **Context:** App snapshots are versioned and local wall times can be ambiguous.
- **Decision:** Support new apps and requested upgrades, with explicit fold choices.
- **Rationale:** User selected: "Recommended: new dashboards plus explicitly
  requested upgrades of older apps; preserve existing range instants, reject
  nonexistent local times, and make repeated-hour choices explicit."
- **Alternatives considered:** Automatic snapshot migration (unrequested);
  silently choose the earlier fold occurrence (ambiguous).
- **Decided by:** USER
- **Rollback lever:** Remove opt-in upgrades and restore prior picker behavior.
- **Consequences:** Existing published apps do not change automatically.

### ADR-003: Distinguish instant windows from calendar-relative filters

- **Context:** The follow-up discussion distinguishes Last 24 hours from Today.
- **Decision:** Preserve fixed/elapsed windows; explicit calendar presets use the
  selected zone and visibly name it.
- **Rationale:** AGENT recommendation from the discussed contract: local-day and
  UTC-day boundaries differ; preserving a Today label while retaining a different
  zone's boundaries would be misleading.
- **Alternatives considered:** Reinterpret fixed endpoints (moves events);
  keep Today boundaries but relabel them (misstates the filter).
- **Decided by:** AGENT
- **Rollback lever:** Omit the optional calendar timestamp presets.
- **Consequences:** Calendar-preset query keys include the selected zone.

### ADR-004: Explicit semantic types, not metadata inference

- **Context:** The inspected App Builder schemas omit needed source distinctions.
- **Decision:** Require confirmed authored semantics; add no automatic HTTP parser.
- **Rationale:** ISO Z does not distinguish Dataverse UserLocal from
  TimeZoneIndependent; SharePoint DateTime alone does not distinguish date-only.
- **Alternatives considered:** Guess from strings (wrong); expand schema tools
  now (separate runtime/API feature).
- **Decided by:** AGENT
- **Rollback lever:** Remove the new typed temporal formatting API.
- **Consequences:** Unknown fields require metadata confirmation before conversion.

### ADR-005: Stable calendar-preset admission

- **Context:** A month-to-date range can fit a short cap in Local while exceeding
  it in UTC, leaving an admitted URL selection without valid query bounds.
- **Decision:** Require the complete calendar preset's budget at admission:
  one day for Today/Yesterday and 31 days for This month, independent of clock
  and display zone. Preserve existing fixed/elapsed/custom cap behavior.
- **Rationale:** One stable contract prevents mode changes and DST-offset
  arithmetic from invalidating an otherwise admitted calendar selection.
- **Alternatives considered:** Revalidate only in query construction (throws
  after selection); silently choose another window (changes the user's filter).
- **Decided by:** AGENT
- **Rollback lever:** Omit the optional calendar timestamp presets.
- **Consequences:** A short cap cannot offer This month even early in the month.

### ADR-006: One header-level display control

- **Context:** Diagnostic fixture screenshots looked like a proposed dashboard
  and repeated zone labels beside machine-readable ISO range bounds.
- **Decision:** One Local/UTC dropdown beside Copy link; no repeated chart
  captions. Normal dashboard values remain human-readable. Test-only raw
  bounds and provenance belong in explicitly closed validation diagnostics.
- **Rationale:** One dashboard-wide indicator states the mode once; repeating
  the zone under every chart adds noise without adding information.
- **Alternatives considered:** Repeat UTC under every chart (visual noise);
  remove the global mode indication (ambiguous timestamps).
- **Decided by:** USER
- **Rollback lever:** Restore the prior selector and controlled chart captions.
- **Consequences:** Mode propagation and offset-bearing machine exports remain
  unchanged; the fixture is not a product dashboard design.

## Source contracts

- [Dataverse behavior and format](https://learn.microsoft.com/en-us/power-apps/maker/data-platform/behavior-format-date-time-field)
- [SharePoint dateTimeColumn](https://learn.microsoft.com/en-us/graph/api/resources/datetimecolumn)
- [Kusto datetime](https://learn.microsoft.com/en-us/kusto/query/scalar-data-types/datetime?view=azure-data-explorer)
- [SQL date/time types](https://learn.microsoft.com/en-us/sql/t-sql/data-types/date-and-time-types-transact-sql)
