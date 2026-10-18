# Standalone pages: step 1 rollout

Flag: `htpr-7298-standalone-pages` (Owner + QA). This release adds only browser-session APIs; new screens and MCP/CLI/AI operations are out of scope. `Page.projectId` owns access; ticket links never grant page access. Existing nullable-page reads and editor safety are unconditional.

## Activation barrier

1. Pause permanent task deletion and page/task-board mutations while applying the migration. Use a reviewed maintenance window and database lock timeout: the migration takes an exclusive Page lock. Preserve the migration backup table.
2. Promote the complete compatible build atomically. Keep new APIs unused until the Production deployment succeeds **and all old readers, writers, movers and task-delete workers, including in-flight requests, have drained**. Default Owner + QA targeting is not permission to start QA before this barrier. Keep the flag Off during an overlapping rollout if the drain cannot be demonstrated.
3. Only then resume lifecycle workers and begin Owner + QA browser API checks. Nullable task lifetime is global, so deletion must not resume with old required-task readers remaining, even for flag-off users. Never run a mixed old/new mover deployment with multi-link states enabled.
4. Ticket lists retain `links.some(taskId) OR taskId` for old-writer compatibility. Every new ticket-page creator dual-writes its edge; moves materialize missing legacy edges under their transaction's page lock. Do not remove the OR branch in this release.
5. `pages-v2` is a clean page-only index namespace. Old `pages` rows contain task metadata and must never be reused. After migration and drain, use the existing `turbopufferPageInclude`, `buildTurbopufferPageRow` and `upsertPageRowsToTurbopuffer` maintenance functions to rebuild all unarchived pages in controlled batches; verify row boards against Page.projectId. Retire the old namespace only under a separately authorized operator procedure. No live page-index reader exists in this release; index rebuilding is not a reason to expose old rows. Moves reindex committed ownership changes; guest deletion removes deleted page rows. Link/origin changes do not need indexing because ticket metadata is absent.

No production migration, rollout, index rebuild or deletion was performed during development. The exact SQL was tested only in disposable Postgres; see build evidence for provenance and measurements.

## Recovery

Disable the feature flag and forward-fix using a nullable/link-aware build. Never revert to task-owned authorization or required-task consumers after this migration. Standalone, multi-link and deleted-origin states cannot be represented safely by old code; even a moved legacy pointer can expose a page to the wrong board.

Do not restore `_htpr7298_page_project_backup` automatically: it is historical evidence of pre-migration stale boards, not authorization to undo later intentional page moves. Do not rerun the migration's initial board reconciliation after feature adoption: a page and its legacy ticket may now intentionally belong to different boards. Recovery requires a reviewed write freeze and forward-compatible application/schema procedure, never deleting taskless pages to restore NOT NULL.

## Step 2 (separate ticket)

After the agreed observation period, drain old writers, reconcile missing legacy links and refuse to drop Page.taskId while any non-null current pair lacks a PageTaskLink. Only that later release removes compatibility reads/writes; it must retain current page-board permissions and nullable navigation.

Credential-team scope remains the separate HTPR-7179 change. This release preserves existing shared predicates and does not claim to fix or widen that known credential boundary.
