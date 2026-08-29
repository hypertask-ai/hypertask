# Native Reports v1 specification

Status: proposed for product and mockup approval in HTPR-4251.

## Outcome

Native Reports let a board member save a live, board-scoped analysis assembled from a metric, grouping, date range, and visualization. Results always recompute from current Hypertask data.

This is separate from Generated Reports. Generated Reports remain immutable HTML snapshots created by people or agents and rendered in the existing sandbox.

## V1 product boundary

- Available to every user with access to the selected board. There is no plan gate.
- One board per report. Cross-board reporting is deferred.
- Saved reports are shared with everyone who can access that board. V1 has no personal/private reports.
- Native Reports are created and edited on desktop. Mobile users can read the responsive result; mobile editing is deferred.
- CSV export, scheduled or emailed reports, MCP/CLI management, and custom formulas are deferred.
- Existing Generated Reports and the built-in Velocity report continue to work unchanged.

## Entry points and navigation

- The Reports hub at `/report` remains the index for Generated Reports, built-in reports, and Native Reports.
- `Create native report...` and `Edit native report...` are Ctrl+K commands. V1 adds no global rail item, shortcut, board tab, floating button, or settings page.
- Creation opens `/report/project-{projectId}/native/new`. A saved report opens `/report/project-{projectId}/native/{slug}`.
- The report page uses the existing `ReportShell`, app rail, back action, typography, spacing, colors, and responsive page width.
- No keyboard shortcut is proposed. A shortcut requires a separate owner-approved key decision and all four registrations in the shortcut contract.

## Builder

The full-page builder keeps configuration in one compact `bg-containerBackground` panel above a live preview. Each option uses the existing property-row pattern: a muted fixed-width label and one value.

Configuration fields:

1. **Name**: required, 1–120 characters. The slug is generated from the name, stored in canonical lowercase form, and stays stable after creation. If that normalized slug already exists on the board, creation appends the lowest available numeric suffix (`delivery`, `delivery-2`, `delivery-3`). The create API returns the canonical slug and retries the database's `(projectId, slug)` constraint for concurrent creators. Callers cannot supply a differently-cased stored slug.
2. **Metric**: one metric from the supported list below.
3. **Group by**: one compatible grouping, including `None` for a single result.
4. **Date range**: Today, 7 days, 14 days, 30 days, 3 months, 6 months, or 12 months. Event metrics store the relative range, not fixed dates. For `Current tasks` and `Work in progress`, the row becomes a read-only `As of now` value and the saved range is `null`.
5. **Visualization**: Number, line, bar, or stacked bar. Only compatible choices are offered.

The preview updates after a short debounce. Loading and query errors stay inside the preview region, so configuration remains editable.

Save and cancel use the existing keyboard-first action-row pattern. `Ctrl+Enter` saves and `Esc` cancels. These are modal editing conventions, not new global shortcuts.

Native chart routes lazy-load Recharts, the charting choice recorded in HTPR-4253. Every visualization includes the same values in an accessible text summary; color is never the only grouping signal.

## Metrics and compatibility

| Metric           | Definition                                                                          | Allowed grouping                               | Allowed visualization          |
| ---------------- | ----------------------------------------------------------------------------------- | ---------------------------------------------- | ------------------------------ |
| Tasks created    | Count of task-created events in the range                                           | None, time, section, assignee, label           | Number, line, bar, stacked bar |
| Tasks finished   | Count of first entries into a finished section or Archive in the range              | None, time, finishing section, assignee, label | Number, line, bar, stacked bar |
| Current tasks    | Count of Normal tasks at query time                                                 | None, current section, assignee, label         | Number, bar, stacked bar       |
| Work in progress | Count of Normal tasks currently in a non-finished section                           | None, current section, assignee, label         | Number, bar, stacked bar       |
| Time to finish   | Median duration from creation to first finish event for tasks finished in the range | None, time, finishing section, assignee, label | Number, line, bar              |

`Time` means hour for Today, day for 7–30 days, week for 3–6 months, and month for 12 months. Assignee and label groups use the task snapshot at the measured event. Multi-assignee and multi-label tasks contribute once to each selected group, and the UI states this beside grouped results.

`Current tasks` and `Work in progress` are snapshots at query time. They never reconstruct a historical as-of state. Their create/update validator requires `range = null`, and the query route rejects a range for either metric. The other three metrics require a non-null range. This prevents two differently ranged saved snapshots from producing the same report.

`Tasks finished` and `Time to finish` read the durable canonical `TaskFirstFinish` row described below, then apply the requested date range to that row's `occurredAt`. A task created directly in a finished section therefore finishes at creation with zero duration. A later archive, second finished-column entry, or reopen does not replace the canonical row. A task whose first finish predates the selected range is not counted as finished in the range, even if it finishes again inside the range.

V1 deliberately omits reopen rate, cumulative flow, estimates, percentiles other than median, formulas, and arbitrary field groupings. These require additional semantics rather than more controls.

## Saved definition

Add a `NativeReport` model instead of overloading the existing Generated Report model:

```text
NativeReport
  id            Int       primary key
  projectId     Int       board foreign key, cascade delete
  slug          String    canonical lowercase output of normalizeReportSlug
  title         String
  metric        NativeReportMetric
  groupBy       NativeReportGrouping
  range         NativeReportRange?   null only for query-time snapshot metrics
  visualization NativeReportVisualization
  createdById   Int?
  createdAt     DateTime
  updatedAt     DateTime

  unique(projectId, slug)
  index(projectId, updatedAt)
```

Configuration uses enums rather than arbitrary JSON in v1. This keeps invalid combinations rejectable at the write boundary and makes future migrations explicit.

Board access controls visibility and mutation. Any board member who may edit board content may create, rename, reconfigure, or delete a Native Report. Read-only guests may only view it.

Report creation is retry-safe. The client generates a UUID `operationId` before its first `POST` attempt and reuses it for every transport retry. A durable `NativeReportCreateReceipt` stores operation id, project id, server-keyed principal HMAC, canonical request hash, created report id, canonical slug, and status; it is unique on operation id and cascades only with the board. After current board-content-edit authorization, creation claims the receipt and inserts the report in one transaction. An exact board/principal/hash retry returns the original report id and slug; any mismatch returns `409`. Deleting the report reduces the receipt result to a `deleted` tombstone, so a delayed retry returns `410` rather than creating a suffixed duplicate. Receipt rows contain no report title or task content.

## Lifecycle event model

Add an immutable `TaskEvent` table. Do not repurpose the dead `Events` model: its missing task/project relationships and untyped metadata would preserve the ambiguity Reports is intended to remove.

```text
TaskEvent
  id                BigInt       primary key
  projectId         Int          board foreign key, cascade delete
  taskId            Int?         nullable task foreign key, set null on hard delete
  taskReportingKey  String       random opaque UUID, never a user-facing task id
  taskCreatedAt     DateTime     immutable Task.createdAt snapshot
  type              TaskEventType
  occurredAt        DateTime
  actorUserId       Int?
  actorAgentId      String?
  sourceKind        TaskEventSource
  eventKey          String       unique, non-null logical idempotency key
  snapshotQuality   TaskEventSnapshotQuality
  sectionKnown      Boolean
  assigneesKnown    Boolean
  labelsKnown       Boolean
  fromSectionId     Int?
  fromSectionTitle  String?
  fromSectionIsDone Boolean?
  toSectionId       Int?
  toSectionTitle    String?
  toSectionIsDone   Boolean?
  assigneeUserIds   Int[]
  assigneeAgentIds  String[]
  labelIds          String[]
  createdAt         DateTime

  index(projectId, occurredAt)
  index(projectId, type, occurredAt)
  index(taskId, occurredAt)
  index(projectId, taskReportingKey, occurredAt)
  GIN index(assigneeUserIds)
  GIN index(assigneeAgentIds)
  GIN index(labelIds)
```

`TaskEventSnapshotQuality` is `FULL`, `PARTIAL`, or `TIME_ONLY`. The three `*Known` flags distinguish a known empty assignment from an unavailable legacy snapshot and let each grouping exclude only rows missing its required dimension.

Add a canonical lifecycle summary whose only purpose is identifying the first finish event; it is not a report aggregate:

```text
TaskFirstFinish
  projectId     Int       board foreign key, cascade delete
  taskReportingKey String
  eventId       BigInt    unique TaskEvent foreign key, cascade delete
  occurredAt    DateTime

  primary key(projectId, taskReportingKey)
  index(projectId, occurredAt)
```

Add `Task.reportingKey UUID`, generated with a cryptographically random UUID and protected by a global unique constraint. It is the authoritative task-to-reporting identity, is never derived from or exposed as the ticket number or database id, and cannot change after assignment. The additive migration first adds it as nullable; while lifecycle writes are fenced, a bounded job assigns keys to every existing task, verifies no nulls or duplicates, and a follow-up migration makes it non-null with a database UUID default for new tasks. Every live writer locks the task row and reads this field; as a rollout fail-safe, encountering null initializes it under that same lock rather than generating an event-local key. Backfill also reads this field and never generates a separate event identity.

Each task identity also has a durable `TaskFinishBaseline` with `(projectId, taskReportingKey)` as its primary key and state `ELIGIBLE` or `UNKNOWN`. New tasks enter `ELIGIBLE`; a direct finished-section creation writes `TaskFirstFinish` in the same transaction. Tasks present when capture begins enter `UNKNOWN` unless authoritative retained history establishes their first finish. Baselines survive task deletion and cascade only with the board.

V1 event types are `TASK_CREATED`, `SECTION_CHANGED`, `TASK_ARCHIVED`, `TASK_UNARCHIVED`, and `TASK_DELETED`. Writes happen in the same transaction as the task mutation. Every lifecycle path locks the task row with `SELECT ... FOR UPDATE` before reading mutable state, capturing snapshots, or applying the change. This serializes concurrent moves, archive operations, and deletion; a waiter re-reads the committed state and takes `occurredAt` from the database clock after acquiring the lock before producing its event. Task creation has no pre-existing row to lock and inserts its initial event in the creation transaction. Every event copies the task's immutable creation time plus board, resolved done state, user and agent attribution, assignees, and labels before mutable state changes or a hard delete removes the task. `TASK_CREATED` stores its initial section in the `toSection*` fields, including `toSectionIsDone`, so direct creation in a finished section is a complete first-finish event. `TASK_ARCHIVED` snapshots the section being archived from and reports its finishing-section group as the reserved `Archive` bucket. PostgreSQL GIN indexes on the snapshot arrays keep grouped queries bounded; the migration adds them explicitly if the Prisma version cannot express them.

When a serialized mutation produces a qualifying finish event, the same transaction inserts `TaskFirstFinish` with `ON CONFLICT (projectId, taskReportingKey) DO NOTHING` only if the baseline is `ELIGIBLE`. Qualifying events are `TASK_CREATED` with `toSectionIsDone`, `SECTION_CHANGED` with `toSectionIsDone`, and `TASK_ARCHIVED`. Because mutations for a surviving task are row-locked, the first committed qualifying transition wins. A task with an `UNKNOWN` pre-capture baseline never promotes a later move or archive to first finish merely because no earlier row was retained. The event and summary both survive task deletion through the opaque reporting key.

`fromSectionIsDone` and `toSectionIsDone` store the resolved value at mutation time, including the legacy name fallback. Later column renames or `isDone` changes therefore do not rewrite historical completion.

Every writer supplies a stable, non-null `eventKey`. Task creation uses `task-created:{projectId}:{taskReportingKey}` for both live and backfilled rows. Live transitions use `task-mutation:{operationId}:{taskReportingKey}:{eventType}`. Event keys never embed the ticket number or task database id. Writers insert with conflict handling on `eventKey`, so a retry cannot create a second logical event. `sourceKind` records where the winning row came from; it is not the deduplication boundary.

When a section move or archive also creates a legacy `Comment.activity` row, the shared mutation writes that same `eventKey` into the activity JSON in the transaction. Backfill uses `activity.eventKey` when present and falls back to `activity:{commentId}` only for activity rows created before event capture existed. A transition represented by both sources therefore has one canonical identity during rollout.

Every event-worthy mutation also persists a `TaskMutationReceipt` in the same database transaction as the task change and event:

```text
TaskMutationReceipt
  operationId   String    primary key
  projectId     Int       board foreign key, cascade delete
  principalKind TaskMutationPrincipalKind
  principalId   String
  method        TaskMutationMethod
  requestHash   String
  result         Json      minimal ids/status only, never task content
  createdAt      DateTime

  index(projectId, createdAt)
```

Browser and API clients generate an operation UUID before the first attempt and reuse it for transport retries. Webhook and queue callers derive it from their stable delivery or job id. HTTP routes reject a missing operation id; internal mutation functions require it in their type signature. Before receipt lookup, every entry point authenticates the current user or agent, authorizes the exact board and mutation, and rejects revoked access without returning a stored result. The canonical request hash covers `projectId`, mutation method, normalized payload, principal kind, and principal id. The receipt stores those same authorization bindings. The transaction then claims `operationId`. A conflict returns the stored result only when the board, method, principal, and request hash all match; any mismatch returns `409` without revealing the prior result. Authorization is repeated inside the transaction where existing mutation paths require it. This receipt, not a newly generated server id, makes a retry after an unknown commit result safe without turning an operation id into an access token.

All existing task-create, section-move, archive, unarchive, and hard-delete callers migrate to this shared mutation boundary before event capture is enabled. There is no legacy path that writes lifecycle state without a receipt and event.

Receipts are durable idempotency tombstones and are retained for the life of the board. They contain only the operation id, request hash, minimal result identifiers/status, and board relationship; they never contain task content. Deleting the board cascades its receipts. No age-based sweep may remove them, so a delayed replay of an old operation id remains safe regardless of transport retry timing. A future retention policy may replace old results with a tombstone containing the operation id and request hash, but it must preserve the uniqueness claim permanently while the board exists.

Canonical `FULL` events are immutable. A live writer that conflicts with a lower-quality backfill placeholder may atomically promote that row to `FULL`, set all three known flags, and fill its snapshots; conflict handling never replaces `FULL` data or reduces `snapshotQuality`. This is the only allowed update to an event row.

Events are retained for the life of the board, but task deletion preserves only de-identified count and duration history. In the hard-delete transaction, all events for the task are irreversibly redacted: `taskId` becomes null; actor ids, assignee arrays, agent arrays, label arrays, section ids, and section titles are cleared; the three known flags become false; and quality becomes `PARTIAL`. Mutation receipts whose result references that task are reduced to a `{ status: "deleted" }` tombstone while preserving their replay claim and request hash. The opaque reporting key, event type, timestamps, creation time, and done-state booleans remain so ungrouped/time totals and duration still work. Grouped queries exclude the redacted dimensions and report them in `excludedIncompleteCount`. This privacy redaction is the second and only other allowed event update besides quality promotion; neither path can restore cleared identifying fields.

TaskEvent and lifecycle-summary tables are internal and have no raw-row API. Report routes return aggregates and completeness metadata only. Existing account-erasure hooks also clear a deleted user's actor id across retained events. If an assignee array contains that user, erasure clears the entire assignee snapshot, sets `assigneesKnown = false`, and makes assignee-grouped queries exclude the event through `excludedIncompleteCount`; it never turns the erased association into a known unassigned snapshot. Receipt principals use a server-keyed stable HMAC rather than a raw user/agent id. Deleting a board cascades its reports, receipts, summaries, and events. Changing this de-identified board-lifetime retention requires a separate product and privacy approval.

Before hard deletion, the transaction also inserts the stable `task-created:{projectId}:{taskReportingKey}` event if it is absent, using `Task.createdAt` with `snapshotQuality = TIME_ONLY`. This keeps creation totals and finish duration available after the task row is gone.

## Backfill

The migration is additive and deploy-safe. After schema deployment, a bounded idempotent job backfills:

- one `TASK_CREATED` event from `Task.createdAt` for every surviving task;
- `SECTION_CHANGED` and archive events from typed `Comment.activity` rows where their payload is valid;
- no invented events for hard-deleted tasks or missing activity history.

Creation backfill reliably knows only task identity, board, and time. It sets `snapshotQuality = TIME_ONLY`, all three known flags to false, and leaves creation-time section, done state, assignee, and label snapshots empty rather than copying mutable current values. Ungrouped and time-grouped creation totals include these rows. Section, assignee, and label groupings exclude them, return an `excludedIncompleteCount`, and explain the incomplete historical dimension in the UI. A legacy task created directly in a finished section cannot be inferred from a time-only row; affected first-finish results carry the same historical completeness boundary instead of treating that row as unfinished.

A legacy activity row is valid only when it has an authoritative task identity, board, event type, occurrence time, and the transition fields required by that event type. Invalid rows are skipped and counted in reconciliation output. Backfill copies a section, assignee, or label snapshot only when that exact historical field exists in the activity payload; absence sets the corresponding known flag to false, never to a known empty array. A row with every required dimension is `FULL`; one with a valid transition but any unavailable grouping dimension is `PARTIAL`. Grouped queries exclude rows whose required known flag is false and return `excludedIncompleteCount` plus the board completeness boundary.

Backfilled rows use `sourceKind = BACKFILL_TASK` or `BACKFILL_ACTIVITY` and the same logical `eventKey` a live writer would use. Backfill is insert-only with `ON CONFLICT (eventKey) DO NOTHING`; it never updates an immutable event or replaces a richer live snapshot. Native Reports label the earliest trustworthy date per board when incomplete history affects the selected range.

A reconciliation pass also inserts missing time-only creation events from `taskCreatedAt` on surviving lifecycle events. For an `UNKNOWN` baseline, it considers only authoritative qualifying legacy events at or before the rollout watermark; a later captured event cannot retroactively prove it was the task's first finish. For eligible/new identities, it considers every qualifying event. Candidates are ordered by `occurredAt`, then event type (`TASK_CREATED`, `SECTION_CHANGED`, `TASK_ARCHIVED`), then event id, and reconciliation upserts `TaskFirstFinish` only when that deterministic candidate is earlier than the stored candidate. Finding an authoritative historical finish resolves the identity through its canonical row; absence of a retained finish does not change an `UNKNOWN` baseline to `ELIGIBLE`. Native writers remain enabled during reconciliation, so this earlier-wins rule safely links an older legacy finish without allowing a post-watermark finish to fill an unknown baseline. `Time to finish` joins the canonical finish event and reads its `taskCreatedAt`, so it remains computable even when the task and creation event disappear unexpectedly. Tasks hard-deleted before event capture left no authoritative row anywhere; API responses return `historyIncompleteBefore`, `excludedUnknownFinishBaselineCount`, and partial labels rather than silently presenting creation or completion history as complete.

## Query and API contract

V1 calculates report results on demand from indexed task and event data. `TaskFirstFinish` stores canonical lifecycle identity, not grouped report values; v1 does not add report rollup tables, queues, or cache invalidation. This is an intentionally bounded first release rather than an unlimited scan path.

- `GET /api/reports/native/{projectId}/{reportSlug}` returns the saved definition after board-access validation.
- `POST /api/reports/native` creates a definition and requires the stable creation `operationId`.
- `PATCH /api/reports/native/{projectId}/{reportSlug}` updates allowed fields.
- `DELETE /api/reports/native/{projectId}/{reportSlug}` deletes a definition after the standard exact confirmation flow.
- `POST /api/reports/native/{projectId}/{reportSlug}/query` loads only that saved definition and returns chart-ready series plus completeness metadata to any authorized board reader.
- `POST /api/reports/native/query/preview` validates a definition-shaped payload for an unsaved builder preview and requires current permission to edit board content.

Both query routes derive user and agent identity from the authenticated request, parse `projectId` as a positive integer, and check that exact board with `getProjectWhere`. The saved route resolves the report by the authorized `(projectId, reportSlug)` composite identity and never accepts definition overrides. The preview route accepts an unsaved definition only after the stricter board-content-edit authorization used by report creation. Both reject incompatible metric/grouping/visualization combinations and ranges beyond 12 months.

Database aggregation returns only grouped results, not raw events. Queries use UTC boundaries and the same calendar-aligned bucket rules as Velocity. A request is capped at 500 returned groups; exceeding it returns a clear validation error rather than truncating silently.

Before aggregation, the route starts a `REPEATABLE READ, READ ONLY` transaction, establishes its snapshot with the guard as the first data statement, and runs aggregation in that same snapshot. The index-backed guard uses the same board and time predicates. `Tasks created` selects TaskEvent ids; `Tasks finished` and `Time to finish` select canonical TaskFirstFinish ids and join their one event only after the range filter. Event guards stop at 250,001 rows; snapshot guards select only task ids and stop at 100,001 Normal tasks. Seeing the final sentinel row rejects the query, so no guard computes an exact count, scans finish events outside the selected range, or scans beyond its budget. `SET LOCAL statement_timeout = '4500ms'` bounds each database statement, while a five-second server request deadline cancels and rolls back the transaction so guard plus aggregation cannot consume two full timeout windows. The API also applies the existing authenticated rate limiter at 30 query requests per user per board per minute. Preview requests cancel superseded fetches and share the saved-report read limit; they do not bypass it. Budget rejection and timeout return a typed `REPORT_QUERY_TOO_LARGE` response with no partial series, plus guidance to choose a shorter range. Current snapshot metrics, which have no shorter range, explain that this board requires the deferred rollup path. Tests use `EXPLAIN` assertions to prove both guards select only ids through the intended indexes, stop at threshold plus one, and run before the expensive grouping step; timeout/rate-limit failures remain recoverable in the builder.

These limits bound both rows examined and execution time; the 500-group cap only bounds response cardinality. Boards that exceed either row budget remain supported by existing reports, but Native Reports stay disabled for the rejected query until precomputed rollups are designed and shipped.

## Rollout and rollback

Rollout has an explicit write fence and sequence boundary:

1. Deploy the additive schema plus a disabled lifecycle-mutation maintenance fence to every production instance. Native Reports remain disabled.
2. Enable that fence, reject new task create/move/archive/unarchive/delete requests with a retryable maintenance response, and drain in-flight lifecycle transactions.
3. While writes remain fenced, roll every production instance to the shared receipt and event writers. Remove old instances and verify no old-version database sessions remain.
4. While every lifecycle write remains fenced, assign and persist unique `Task.reportingKey` values plus `UNKNOWN` baselines for all existing tasks. Verify there are no nulls or duplicates, apply the non-null/default constraint, and record the maximum task and legacy activity primary-key sequence watermarks.
5. Release create, move, archive, and unarchive, but keep hard deletion fenced. Every accepted mutation locks the task and reads its persisted reporting key. Backfill tasks and legacy activities through the recorded inclusive primary-key watermarks, using insert-only conflict handling, then reconcile counts. Because keys were assigned before release and hard deletion remains fenced, live writers cannot split identity and no pre-watermark activity can cascade away before it is copied.
6. Release hard deletion only after backfill and reconciliation finish. Then enable the Native Reports read/write surface.

The boundary does not depend on application clocks, event timestamps, or a strict time comparison. Draining closes old-writer transactions before the sequence watermarks are captured; inclusive watermarks cover every legacy row committed before release. New instances may already have written the same logical event during verification, and the shared key plus quality-aware conflict rule make that overlap safe. Tests interleave fence acquisition, drain completion, watermark capture, live writes, and backfill inserts to prove there is no uncovered mutation and a complete live snapshot is never overwritten or suppressed.

A server-only `NATIVE_REPORTS_ENABLED` switch hides entry commands and returns 404 from Native Report routes without affecting event capture, Generated Reports, or Velocity. The shared receipt and event writers are a forward-compatible lifecycle boundary, not part of the feature rollback surface; once production reaches step 2, later application versions must keep writing them even while Native Reports is disabled.

Enable the feature for all users after production migration, focused authorization tests, event-write tests, query tests, and a live board-15 smoke report pass. Normal rollback disables the switch and reverts only the Native Report UI and query surface; the additive tables and lifecycle writers stay active. If an emergency requires disabling an event writer, operations persist the outage start and recovery cutoff, Native Reports remain disabled, and re-enablement requires reconciliation plus `historyIncompleteBefore` metadata for any interval that cannot be reconstructed. A version that bypasses event capture must never re-enable Native Reports silently.

## Verification contract

- Behavioral tests cover allowed and denied board identities for every route.
- Report-creation tests cover unknown-commit retry, concurrent duplicate operation ids, hash/principal mismatch, slug collision, and retry after deletion.
- Mutation tests prove each task lifecycle path locks mutable state and writes exactly one transactional event with correct snapshots; concurrency tests serialize conflicting moves, archive, and delete.
- Backfill tests prove retry idempotency, deterministic earlier-wins first-finish reconciliation, malformed legacy activity handling, and per-dimension completeness flags.
- Aggregation tests cover UTC boundaries, direct creation in a finished section, unknown pre-capture finish baselines, first-finish tie ordering, multi-value groupings, empty ranges, deleted tasks, and incomplete history.
- Rollback tests prove the feature switch leaves lifecycle capture active and an event-writer outage prevents re-enablement without reconciliation/completeness metadata.
- Query-budget tests cover threshold-plus-one early exit, candidate-row rejection, statement timeout across guard and aggregation, per-user/per-board rate limiting, canceled previews, and the absence of partial results.
- Browser verification covers create, live preview, save, reopen, edit, permissions, responsive read-only mobile rendering, and the disabled feature switch.
- Production verification creates one board-15 smoke report, compares its totals with direct board data through approved product surfaces, reloads it, and confirms an unauthorized board cannot be queried.

## Explicitly deferred

- Cross-board and team-wide reports
- Personal/private reports
- CSV or image export
- Scheduled and emailed reports
- MCP, CLI, and AI-chat Native Report management
- Mobile report editing
- Custom ranges, formulas, percentiles, estimates, and custom-field groupings
- Precomputed rollups and long-term retention controls
- Replacing or deleting Generated Reports, Velocity, or the external velocity dashboard
