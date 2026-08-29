-- HTPR-4436: structured agent work-sessions on a ticket.
-- New enum + new table + FKs. Touches no existing table's data.
CREATE TYPE "SessionStatus" AS ENUM ('Active', 'Idle', 'Dead');

CREATE TABLE "TaskSession" (
    "id" SERIAL NOT NULL,
    "sessionId" TEXT NOT NULL,
    "taskId" INTEGER NOT NULL,
    "resumeCommand" TEXT,
    "status" "SessionStatus" NOT NULL DEFAULT 'Active',
    "agentId" TEXT,
    "startedById" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TaskSession_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TaskSession_sessionId_key" ON "TaskSession"("sessionId");
CREATE INDEX "TaskSession_taskId_idx" ON "TaskSession"("taskId");

ALTER TABLE "TaskSession" ADD CONSTRAINT "TaskSession_taskId_fkey"
    FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TaskSession" ADD CONSTRAINT "TaskSession_agentId_fkey"
    FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "TaskSession" ADD CONSTRAINT "TaskSession_startedById_fkey"
    FOREIGN KEY ("startedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
