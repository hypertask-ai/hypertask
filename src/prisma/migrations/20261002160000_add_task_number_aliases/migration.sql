-- Preserve former ticket identifiers when a task moves between boards.
CREATE TABLE "TaskNumberAlias" (
    "id" SERIAL NOT NULL,
    "projectId" INTEGER NOT NULL,
    "uniqueIndex" INTEGER NOT NULL,
    "ticketNumber" TEXT,
    "taskId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TaskNumberAlias_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TaskNumberAlias_projectId_uniqueIndex_key" ON "TaskNumberAlias"("projectId", "uniqueIndex");
CREATE INDEX "TaskNumberAlias_ticketNumber_idx" ON "TaskNumberAlias"("ticketNumber");
CREATE INDEX "TaskNumberAlias_taskId_idx" ON "TaskNumberAlias"("taskId");

ALTER TABLE "TaskNumberAlias" ADD CONSTRAINT "TaskNumberAlias_taskId_fkey"
    FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;
