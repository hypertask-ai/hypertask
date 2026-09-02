-- HTPR-6000: the minute-ly hard-delete sweep (src/pages/api/queues/sweep.ts)
-- deletes Attachment, Follower, Reaction, and TaskSharing rows by taskId, but
-- none of the four carried an index beyond their primary key, forcing a full
-- table scan per deleted task on every one of them.
--
-- Plain CREATE INDEX takes a brief write lock while it builds. On these live
-- tables this should be applied by hand as CREATE INDEX CONCURRENTLY before
-- migrate deploy runs (matching the existing pattern in this repo, see
-- 20260704180000_add_sweep_indexes and 20260901120000_comment_task_created_at_index).
-- IF NOT EXISTS keeps that pre-application a no-op for migrate deploy's own ledger.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "Follower_taskId_idx" ON "Follower"("taskId");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "Reaction_taskId_idx" ON "Reaction"("taskId");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "Attachment_taskId_idx" ON "Attachment"("taskId");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "TaskSharing_taskId_idx" ON "TaskSharing"("taskId");
