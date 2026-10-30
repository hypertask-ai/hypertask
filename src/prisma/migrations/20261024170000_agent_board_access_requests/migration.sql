ALTER TYPE "NotificationType" ADD VALUE 'AgentBoardAccessRequest';
CREATE TYPE "AgentBoardAccessRequestStatus" AS ENUM ('pending', 'approved', 'declined', 'expired', 'cancelled');
CREATE TABLE "AgentBoardAccessRequest" (
    "id" TEXT NOT NULL,
    "agentId" TEXT,
    "projectId" INTEGER,
    "agentIdAtRequest" TEXT NOT NULL,
    "projectIdAtRequest" INTEGER NOT NULL,
    "ownerUserIdAtRequest" INTEGER NOT NULL,
    "targetTeamIdAtRequest" TEXT NOT NULL,
    "credentialTeamId" TEXT,
    "credentialTeamAccessBinding" TEXT,
    "tokenGeneration" TEXT,
    "runtimeGeneration" INTEGER NOT NULL,
    "reason" VARCHAR(1000) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "status" "AgentBoardAccessRequestStatus" NOT NULL DEFAULT 'pending',
    "resolvedAt" TIMESTAMP(3),
    "decidedByUserId" INTEGER,
    "resolutionReason" TEXT,
    "memberId" INTEGER,
    CONSTRAINT "AgentBoardAccessRequest_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "AgentBoardAccessRequest_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "AgentBoardAccessRequest_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "AgentBoardAccessRequest_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "AgentBoardAccessRequest_pending_key" ON "AgentBoardAccessRequest"("agentId", "projectId") WHERE "status" = 'pending';
CREATE INDEX "AgentBoardAccessRequest_ownerUserIdAtRequest_status_expiresAt_idx" ON "AgentBoardAccessRequest"("ownerUserIdAtRequest", "status", "expiresAt");
CREATE INDEX "AgentBoardAccessRequest_agentId_createdAt_idx" ON "AgentBoardAccessRequest"("agentId", "createdAt");
ALTER TABLE "Notification" ADD COLUMN "boardAccessRequestId" TEXT;
CREATE UNIQUE INDEX "Notification_boardAccessRequestId_key" ON "Notification"("boardAccessRequestId");
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_boardAccessRequestId_fkey" FOREIGN KEY ("boardAccessRequestId") REFERENCES "AgentBoardAccessRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE INDEX "Logs_agent_board_access_disabled_createdAt_idx" ON "Logs"("createdAt") WHERE "log" = 'agent_board_access_requests_disabled';
