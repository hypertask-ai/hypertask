ALTER TABLE "Task" ADD COLUMN "waitingOnAgentId" TEXT;

CREATE INDEX "Task_waitingOnAgentId_idx" ON "Task"("waitingOnAgentId");

ALTER TABLE "Task" ADD CONSTRAINT "Task_waitingOnAgentId_fkey" FOREIGN KEY ("waitingOnAgentId") REFERENCES "Agent"("id") ON DELETE SET NULL ON UPDATE CASCADE;
