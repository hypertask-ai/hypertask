-- HTPR-5881: the Inbox unread-count query (notificationGetAll) filters Comment
-- by taskId plus a per-task createdAt threshold. Only [taskId, creatorId]
-- existed, leaving createdAt unindexed for that filter.
--
-- NOTE: plain CREATE INDEX takes a brief write lock while it builds. On a large
-- live "Comment" table, run this as CREATE INDEX CONCURRENTLY by hand instead
-- (cannot run inside a migration transaction). IF NOT EXISTS makes that
-- pre-creation a no-op here.
CREATE INDEX IF NOT EXISTS "Comment_taskId_createdAt_idx" ON "Comment"("taskId", "createdAt");
