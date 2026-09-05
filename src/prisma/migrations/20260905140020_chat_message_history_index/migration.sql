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
-- IF NOT EXISTS keeps the migration a no-op when the index was pre-applied by
-- hand against prod, which is the pattern those two files document.
--
-- A DROP INDEX CONCURRENTLY before each build would also clear the INVALID
-- index an interrupted concurrent build leaves behind, but it cannot live in
-- this file. Verified against postgres:16 through `prisma migrate deploy`:
-- several CREATE INDEX CONCURRENTLY statements in one migration file apply
-- fine (20260903120000 in this folder has four and deploys clean), while a
-- DROP INDEX CONCURRENTLY sharing a file with any second statement aborts the
-- whole deploy with SQLSTATE 25001. A lone DROP in its own file is fine, which
-- is what 20260905140030 is.
--
-- ponytail: no cleanup of an interrupted build. Ceiling: if one is
-- interrupted, its INVALID index must be dropped and rebuilt by hand, because
-- IF NOT EXISTS makes this migration skip a name that already exists.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "ChatMessage_sessionId_createdAt_id_idx" ON "ChatMessage"("sessionId", "createdAt", "id");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "ChatMessage_authorUserId_idx" ON "ChatMessage"("authorUserId");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "ChatMessage_authorAgentId_idx" ON "ChatMessage"("authorAgentId");
