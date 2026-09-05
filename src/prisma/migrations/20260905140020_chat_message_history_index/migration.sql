-- Backs ordered, cursor-paginated agent chat history: sessionId, then createdAt
-- with id as the tiebreak so a page boundary is reproducible.
--
-- CONCURRENTLY, matching the newest index migrations in this folder
-- (20260901120000_comment_task_created_at_index,
-- 20260903120000_index_taskid_delete_sweep_targets): a plain build holds a
-- SHARE lock for its whole duration and blocks every chat message insert.
-- IF NOT EXISTS keeps a hand-applied pre-creation a no-op for migrate deploy.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "ChatMessage_sessionId_createdAt_id_idx" ON "ChatMessage"("sessionId", "createdAt", "id");
