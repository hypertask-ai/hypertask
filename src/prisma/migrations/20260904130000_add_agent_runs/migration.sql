CREATE TYPE "AgentRunTrigger" AS ENUM ('MENTION', 'ASSIGNED', 'CHAT');
CREATE TYPE "AgentRunStatus" AS ENUM ('ACTIVE', 'STALE', 'STOPPED', 'DONE');

CREATE TABLE "AgentRun" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "taskId" INTEGER,
    "chatSessionId" TEXT,
    "trigger" "AgentRunTrigger" NOT NULL,
    "status" "AgentRunStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastActivityAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "stoppedById" INTEGER,

    CONSTRAINT "AgentRun_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "AgentRun_context_check" CHECK (num_nonnulls("taskId", "chatSessionId") = 1)
);

CREATE INDEX "AgentRun_agentId_status_idx" ON "AgentRun"("agentId", "status");
CREATE INDEX "AgentRun_taskId_status_idx" ON "AgentRun"("taskId", "status");
CREATE INDEX "AgentRun_chatSessionId_status_idx" ON "AgentRun"("chatSessionId", "status");
CREATE INDEX "AgentRun_lastActivityAt_status_idx" ON "AgentRun"("lastActivityAt", "status");

-- Prisma cannot express partial unique indexes. These make first-interaction
-- creation race-safe while allowing any number of stopped or completed runs.
CREATE UNIQUE INDEX "AgentRun_nonterminal_task_key"
    ON "AgentRun"("agentId", "taskId")
    WHERE "taskId" IS NOT NULL AND "status" IN ('ACTIVE', 'STALE');
CREATE UNIQUE INDEX "AgentRun_nonterminal_chat_key"
    ON "AgentRun"("agentId", "chatSessionId")
    WHERE "chatSessionId" IS NOT NULL AND "status" IN ('ACTIVE', 'STALE');

ALTER TABLE "AgentRun" ADD CONSTRAINT "AgentRun_agentId_fkey"
    FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AgentRun" ADD CONSTRAINT "AgentRun_taskId_fkey"
    FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AgentRun" ADD CONSTRAINT "AgentRun_chatSessionId_fkey"
    FOREIGN KEY ("chatSessionId") REFERENCES "ChatSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AgentRun" ADD CONSTRAINT "AgentRun_stoppedById_fkey"
    FOREIGN KEY ("stoppedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
