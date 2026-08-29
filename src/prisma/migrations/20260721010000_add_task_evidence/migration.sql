-- HTPR-4443: typed proof-of-work evidence attached to a ticket.
-- New enum + new table + FK. Touches no existing table's data.
CREATE TYPE "EvidenceType" AS ENUM ('TestRun', 'Screenshot', 'Deploy', 'Diff', 'Link', 'Other');

CREATE TABLE "TaskEvidence" (
    "id" SERIAL NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "taskId" INTEGER NOT NULL,
    "type" "EvidenceType" NOT NULL DEFAULT 'Other',
    "title" TEXT,
    "url" TEXT,
    "summary" TEXT,
    "creatorId" INTEGER,
    "agentId" TEXT,
    CONSTRAINT "TaskEvidence_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "TaskEvidence_taskId_idx" ON "TaskEvidence"("taskId");

ALTER TABLE "TaskEvidence" ADD CONSTRAINT "TaskEvidence_taskId_fkey"
    FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;
