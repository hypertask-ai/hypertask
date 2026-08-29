-- CreateEnum
CREATE TYPE "AgentRuntimeType" AS ENUM ('EXTERNAL', 'NATIVE');

-- AlterTable
ALTER TABLE "ChatSession" ADD COLUMN     "agentId" TEXT;

-- AlterTable
ALTER TABLE "Agent" ADD COLUMN     "heartbeatAt" TIMESTAMP(3),
ADD COLUMN     "prompt" TEXT,
ADD COLUMN     "runtimeType" "AgentRuntimeType" NOT NULL DEFAULT 'EXTERNAL';

-- CreateIndex
CREATE INDEX "ChatSession_agentId_idx" ON "ChatSession"("agentId");

-- AddForeignKey
ALTER TABLE "ChatSession" ADD CONSTRAINT "ChatSession_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

