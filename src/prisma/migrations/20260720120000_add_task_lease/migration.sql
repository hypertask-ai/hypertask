-- HTPR-4433: atomic, expiring task claims for MCP agents.
CREATE TABLE "TaskLease" (
    "taskId" INTEGER NOT NULL,
    "holder" INTEGER NOT NULL,
    "agentId" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "heartbeatAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX "TaskLease_taskId_key" ON "TaskLease"("taskId");

ALTER TABLE "TaskLease" ADD CONSTRAINT "TaskLease_taskId_fkey"
    FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "TaskLease" ADD CONSTRAINT "TaskLease_holder_fkey"
    FOREIGN KEY ("holder") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
