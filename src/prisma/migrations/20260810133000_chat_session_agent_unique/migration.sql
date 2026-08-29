-- DropIndex
DROP INDEX "ChatSession_agentId_idx";

-- CreateIndex
CREATE UNIQUE INDEX "ChatSession_userId_agentId_key" ON "ChatSession"("userId", "agentId");
