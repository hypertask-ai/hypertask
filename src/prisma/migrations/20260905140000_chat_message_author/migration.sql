-- Actor attribution for chat history: which person or which agent wrote a
-- message, which `role` alone cannot say. Both columns are nullable, so this
-- is an add-column only, no table rewrite.
ALTER TABLE "ChatMessage" ADD COLUMN "authorUserId" INTEGER;
ALTER TABLE "ChatMessage" ADD COLUMN "authorAgentId" TEXT;

-- A message has one author at most. Machine-generated turns (the heartbeat
-- prompt, run system notices) and the built-in AI assistant have none.
ALTER TABLE "ChatMessage" ADD CONSTRAINT "ChatMessage_author_check"
  CHECK (NOT ("authorUserId" IS NOT NULL AND "authorAgentId" IS NOT NULL));

ALTER TABLE "ChatMessage" ADD CONSTRAINT "ChatMessage_authorUserId_fkey"
  FOREIGN KEY ("authorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ChatMessage" ADD CONSTRAINT "ChatMessage_authorAgentId_fkey"
  FOREIGN KEY ("authorAgentId") REFERENCES "Agent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill. Every stored message already implies its author: a delivered human
-- message is the session owner's, a delivered assistant message in an agent
-- session is that agent's. Undelivered rows are machine-generated markers and
-- stay unattributed, which is what the runtime does for new rows too.
UPDATE "ChatMessage" AS message
SET "authorUserId" = session."userId"
FROM "ChatSession" AS session
WHERE message."sessionId" = session."id"
  AND message."role" = 'human'
  AND message."isDelivered" = true;

UPDATE "ChatMessage" AS message
SET "authorAgentId" = session."agentId"
FROM "ChatSession" AS session
WHERE message."sessionId" = session."id"
  AND message."role" = 'assistant'
  AND message."isDelivered" = true
  AND session."agentId" IS NOT NULL;

CREATE INDEX "ChatMessage_sessionId_createdAt_id_idx" ON "ChatMessage"("sessionId", "createdAt", "id");
CREATE INDEX "ChatMessage_authorUserId_idx" ON "ChatMessage"("authorUserId");
CREATE INDEX "ChatMessage_authorAgentId_idx" ON "ChatMessage"("authorAgentId");
