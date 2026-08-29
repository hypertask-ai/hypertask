-- HTPR-5618: prevent recovery from emitting task.created before post-create
-- column auto-assignment has committed.
ALTER TABLE "Task" ADD COLUMN "agentTaskCreatedReadyAt" TIMESTAMP(3);

DROP INDEX IF EXISTS "Task_agentTaskCreatedPendingAt_agentTaskCreatedEmittedAt_idx";

CREATE INDEX "Task_agentTaskCreatedPendingAt_agentTaskCreatedReadyAt_agentTaskCreatedEmittedAt_idx"
  ON "Task"("agentTaskCreatedPendingAt", "agentTaskCreatedReadyAt", "agentTaskCreatedEmittedAt");
