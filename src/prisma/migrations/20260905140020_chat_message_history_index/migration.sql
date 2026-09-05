-- Backs ordered, cursor-paginated agent chat history: sessionId, then createdAt
-- with id as the tiebreak so a page boundary is reproducible. The two author
-- indexes are not for a query: Postgres does not index a referencing column
-- automatically, so without them every User or Agent delete seq-scans
-- ChatMessage to null out its ON DELETE SET NULL rows.
--
-- CONCURRENTLY, because a plain build holds a SHARE lock for its whole
-- duration and blocks every chat message insert. Several concurrent builds in
-- one migration file is the established shape here and is already deployed:
-- 20260708100326_archived_view_indexes carries four and
-- 20260903120000_index_taskid_delete_sweep_targets carries five.
-- IF NOT EXISTS keeps the migration a no-op when an index was pre-applied by
-- hand against prod, which is the pattern those files document.
--
-- ponytail: no cleanup of an interrupted build. Ceiling: a cancelled
-- concurrent build leaves an INVALID index under the same name, and
-- IF NOT EXISTS then skips rebuilding it, so it must be dropped and rebuilt by
-- hand. Detect with: SELECT indexrelid::regclass FROM pg_index
-- WHERE NOT indisvalid;
CREATE INDEX CONCURRENTLY IF NOT EXISTS "ChatMessage_sessionId_createdAt_id_idx" ON "ChatMessage"("sessionId", "createdAt", "id");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "ChatMessage_authorUserId_idx" ON "ChatMessage"("authorUserId");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "ChatMessage_authorAgentId_idx" ON "ChatMessage"("authorAgentId");
