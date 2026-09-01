-- Optional board cycles are additive: existing boards remain Kanban-only and
-- existing tasks stay unassigned.
ALTER TABLE "Project"
ADD COLUMN "cyclesEnabled" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "Cycle" (
  "id" SERIAL NOT NULL,
  "projectId" INTEGER NOT NULL,
  "number" INTEGER NOT NULL,
  "startDate" DATE NOT NULL,
  "endDate" DATE NOT NULL,
  "rolledOverAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "Cycle_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Cycle_number_positive" CHECK ("number" > 0),
  CONSTRAINT "Cycle_starts_monday" CHECK (EXTRACT(ISODOW FROM "startDate") = 1),
  CONSTRAINT "Cycle_fixed_length" CHECK ("endDate" = "startDate" + 14)
);

CREATE UNIQUE INDEX "Cycle_projectId_id_key" ON "Cycle"("projectId", "id");
CREATE UNIQUE INDEX "Cycle_projectId_number_key" ON "Cycle"("projectId", "number");
CREATE UNIQUE INDEX "Cycle_projectId_startDate_key" ON "Cycle"("projectId", "startDate");
CREATE INDEX "Cycle_projectId_endDate_rolledOverAt_idx" ON "Cycle"("projectId", "endDate", "rolledOverAt");

ALTER TABLE "Cycle"
ADD CONSTRAINT "Cycle_projectId_fkey"
FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Task"
ADD COLUMN "cycleId" INTEGER;

CREATE INDEX "Task_projectId_cycleId_status_idx" ON "Task"("projectId", "cycleId", "status");

-- Including projectId in the relation prevents every write surface, not only
-- the cycle picker, from assigning a task to another board's cycle.
ALTER TABLE "Task"
ADD CONSTRAINT "Task_projectId_cycleId_fkey"
FOREIGN KEY ("projectId", "cycleId") REFERENCES "Cycle"("projectId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
