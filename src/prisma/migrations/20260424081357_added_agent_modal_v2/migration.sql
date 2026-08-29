-- AlterTable
ALTER TABLE "Assignees" ADD COLUMN     "agentAssignerId" TEXT,
ADD COLUMN     "agentId" TEXT;

-- AlterTable
ALTER TABLE "Comment" ADD COLUMN     "agentId" TEXT;

-- AlterTable
ALTER TABLE "Description" ADD COLUMN     "agentId" TEXT;

-- AlterTable
ALTER TABLE "Estimate" ADD COLUMN     "addedByAgentId" TEXT;

-- AlterTable
ALTER TABLE "Notification" ADD COLUMN     "agentId" TEXT,
ADD COLUMN     "fromAgentId" TEXT;

-- AlterTable
ALTER TABLE "OAuthAuthorizationCode" ADD COLUMN     "agent_id" TEXT;

-- AlterTable
ALTER TABLE "Priority" ADD COLUMN     "addedByAgentId" TEXT;

-- AlterTable
ALTER TABLE "Project" ALTER COLUMN "sorting_mode" SET DEFAULT 'Priority';

-- AlterTable
ALTER TABLE "Task" ADD COLUMN     "agentId" TEXT;

-- CreateTable
CREATE TABLE "Agent" (
    "id" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "photoURL" TEXT DEFAULT 'https://duv2gcpdgd578.cloudfront.net/tasks/attachments/1757584422625image.png',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),
    "userId" INTEGER NOT NULL,
    "permissions" JSONB DEFAULT '{}',

    CONSTRAINT "Agent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Agent_userId_idx" ON "Agent"("userId");

-- CreateIndex
CREATE INDEX "Agent_userId_revokedAt_idx" ON "Agent"("userId", "revokedAt");

-- CreateIndex
CREATE INDEX "OAuthAuthorizationCode_agent_id_idx" ON "OAuthAuthorizationCode"("agent_id");

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Priority" ADD CONSTRAINT "Priority_addedByAgentId_fkey" FOREIGN KEY ("addedByAgentId") REFERENCES "Agent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Estimate" ADD CONSTRAINT "Estimate_addedByAgentId_fkey" FOREIGN KEY ("addedByAgentId") REFERENCES "Agent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Assignees" ADD CONSTRAINT "Assignees_agentAssignerId_fkey" FOREIGN KEY ("agentAssignerId") REFERENCES "Agent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Assignees" ADD CONSTRAINT "Assignees_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Comment" ADD CONSTRAINT "Comment_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Description" ADD CONSTRAINT "Description_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_fromAgentId_fkey" FOREIGN KEY ("fromAgentId") REFERENCES "Agent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OAuthAuthorizationCode" ADD CONSTRAINT "OAuthAuthorizationCode_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "Agent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Agent" ADD CONSTRAINT "Agent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
