-- Backs ordered, cursor-paginated agent chat history: sessionId, then createdAt
-- with id as the tiebreak so a page boundary is reproducible. The two author
-- indexes are not for a query: Postgres does not index a referencing column
-- automatically, so without them every User or Agent delete seq-scans
-- ChatMessage to null out its ON DELETE SET NULL rows.
--
-- CONCURRENTLY, matching the newest index migrations in this folder
-- (20260901120000_comment_task_created_at_index,
-- 20260903120000_index_taskid_delete_sweep_targets): a plain build holds a
-- SHARE lock for its whole duration and blocks every chat message insert.
--
-- Each build is preceded by a concurrent drop rather than guarded with
-- IF NOT EXISTS alone: an interrupted concurrent build leaves an INVALID index
-- under the same name, and IF NOT EXISTS would then skip the rebuild forever
-- while the planner ignored it and writes still paid for it.
DROP INDEX CONCURRENTLY IF EXISTS "ChatMessage_sessionId_createdAt_id_idx";
CREATE INDEX CONCURRENTLY "ChatMessage_sessionId_createdAt_id_idx" ON "ChatMessage"("sessionId", "createdAt", "id");

DROP INDEX CONCURRENTLY IF EXISTS "ChatMessage_authorUserId_idx";
CREATE INDEX CONCURRENTLY "ChatMessage_authorUserId_idx" ON "ChatMessage"("authorUserId");

DROP INDEX CONCURRENTLY IF EXISTS "ChatMessage_authorAgentId_idx";
CREATE INDEX CONCURRENTLY "ChatMessage_authorAgentId_idx" ON "ChatMessage"("authorAgentId");
