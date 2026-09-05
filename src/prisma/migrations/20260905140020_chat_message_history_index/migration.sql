-- Ordered, cursor-paginated history reads (sessionId, then createdAt with id
-- as the tiebreak). Index builds take a SHARE lock that blocks writes, so they
-- run in their own migration rather than extending the ADD COLUMN lock.
CREATE INDEX "ChatMessage_sessionId_createdAt_id_idx" ON "ChatMessage"("sessionId", "createdAt", "id");
CREATE INDEX "ChatMessage_authorUserId_idx" ON "ChatMessage"("authorUserId");
CREATE INDEX "ChatMessage_authorAgentId_idx" ON "ChatMessage"("authorAgentId");

-- Strict prefix of the composite index above, so it serves no read the new one
-- does not, and costs a second B-tree write on every insert.
DROP INDEX IF EXISTS "ChatMessage_sessionId_idx";
