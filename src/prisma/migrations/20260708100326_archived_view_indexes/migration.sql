-- CreateIndex
-- Supports the /archived view: filter by status + order by archivedAt, with
-- optional per-project narrowing (HTPR-4019).
--
-- PROD APPLICATION (Task and Notification are large, hot tables): apply these
-- CONCURRENTLY by hand BEFORE this migration runs, so the build never takes a
-- write lock. CONCURRENTLY cannot run inside migrate's transaction, hence the
-- manual step — same pattern as Task_ticketNumber_idx:
--   CREATE INDEX CONCURRENTLY IF NOT EXISTS "Task_projectId_status_archivedAt_idx" ON "Task"("projectId", "status", "archivedAt");
--   CREATE INDEX CONCURRENTLY IF NOT EXISTS "Notification_userId_status_archivedAt_idx" ON "Notification"("userId", "status", "archivedAt");
-- The IF NOT EXISTS statements below then no-op under `migrate deploy`. On small
-- envs (preview/dev) the plain CREATE INDEX below is fine to run directly.
CREATE INDEX IF NOT EXISTS "Task_projectId_status_archivedAt_idx" ON "Task"("projectId", "status", "archivedAt");
CREATE INDEX IF NOT EXISTS "Notification_userId_status_archivedAt_idx" ON "Notification"("userId", "status", "archivedAt");
