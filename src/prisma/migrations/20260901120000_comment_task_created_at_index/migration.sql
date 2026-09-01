-- HTPR-5881: the Inbox unread-count query (notificationGetAll) filters Comment
-- by taskId plus a per-task createdAt threshold. Only [taskId, creatorId]
-- existed, leaving createdAt unindexed for that filter.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "Comment_taskId_createdAt_idx" ON "Comment"("taskId", "createdAt");
