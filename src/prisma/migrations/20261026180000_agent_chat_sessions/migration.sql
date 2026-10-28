ALTER TABLE "ChatSession" ADD COLUMN "agentSessionKey" TEXT NOT NULL DEFAULT 'default';
CREATE UNIQUE INDEX "ChatSession_userId_agentId_agentSessionKey_key" ON "ChatSession"("userId", "agentId", "agentSessionKey");
DROP INDEX "ChatSession_userId_agentId_key";
