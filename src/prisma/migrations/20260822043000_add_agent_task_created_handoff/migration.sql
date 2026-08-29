-- HTPR-5618: durable handoff for agent task.created publication.
-- The pending marker commits with the task. A minute sweep retries it when
-- post-create work is interrupted before the agent outbox row is written.
ALTER TABLE "Task" ADD COLUMN "agentTaskCreatedPendingAt" TIMESTAMP(3);
ALTER TABLE "Task" ADD COLUMN "agentTaskCreatedEmittedAt" TIMESTAMP(3);

CREATE INDEX "Task_agentTaskCreatedPendingAt_agentTaskCreatedEmittedAt_idx"
  ON "Task"("agentTaskCreatedPendingAt", "agentTaskCreatedEmittedAt");
