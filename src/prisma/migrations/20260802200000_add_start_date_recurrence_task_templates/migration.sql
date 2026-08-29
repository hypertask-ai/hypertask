-- HTPR-4884/4885/4886: task start dates, recurring tasks, task templates.
-- Purely additive: nullable columns + a new table; no existing row is touched.

CREATE TYPE "RecurrenceRule" AS ENUM ('Daily', 'Weekdays', 'Weekly', 'Biweekly', 'Monthly');

ALTER TABLE "Task"
ADD COLUMN "startDate" TIMESTAMP(3),
ADD COLUMN "recurrence" "RecurrenceRule";

CREATE TABLE "TaskTemplate" (
    "id" SERIAL NOT NULL,
    "projectId" INTEGER NOT NULL,
    "createdById" INTEGER,
    "name" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "descriptionHtml" TEXT NOT NULL DEFAULT '',
    "priorityIndex" INTEGER,
    "estimateIndex" INTEGER,
    "labelIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TaskTemplate_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "TaskTemplate_projectId_idx" ON "TaskTemplate"("projectId");

ALTER TABLE "TaskTemplate" ADD CONSTRAINT "TaskTemplate_projectId_fkey"
FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
