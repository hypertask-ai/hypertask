-- AlterEnum
ALTER TYPE "SortingMode" ADD VALUE 'SectionChangedAt';
ALTER TYPE "SortingMode" ADD VALUE 'LastCommentAt';

-- AlterTable
ALTER TABLE "Task"
ADD COLUMN "sectionChangedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN "lastCommentAt" TIMESTAMP(3);

ALTER TABLE "Project"
ADD COLUMN "stalenessEnabled" BOOLEAN NOT NULL DEFAULT false;

-- Backfill
UPDATE "Task" SET "sectionChangedAt" = COALESCE("updatedAt", "createdAt");

UPDATE "Task" t
SET "lastCommentAt" = c.max
FROM (
  SELECT "taskId", MAX("createdAt") AS max
  FROM "Comment"
  GROUP BY "taskId"
) c
WHERE c."taskId" = t.id;
