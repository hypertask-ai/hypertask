ALTER TABLE "AiUsage"
ADD COLUMN "taskId" INTEGER,
ADD COLUMN "agentId" TEXT;

CREATE INDEX "AiUsage_taskId_createdAt_idx"
ON "AiUsage"("taskId", "createdAt");

CREATE INDEX "AiUsage_agentId_createdAt_idx"
ON "AiUsage"("agentId", "createdAt");
