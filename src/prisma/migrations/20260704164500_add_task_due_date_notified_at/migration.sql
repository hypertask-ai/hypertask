-- AlterTable: marker set once the overdue notification has fired for the current
-- dueDate value; reset to null whenever dueDate changes. Guards invokeDueDate and
-- the sweep (src/pages/api/queues/sweep.ts) against double-firing.
ALTER TABLE "Task" ADD COLUMN "dueDateNotifiedAt" TIMESTAMP(3);

-- Backfill: mark every already-overdue task as notified so the sweep only fires for
-- due dates that cross now() AFTER this deploy. Without this, the first sweep tick
-- would claim every historically-overdue task (dueDateNotifiedAt IS NULL) and blast
-- an overdue notification for each one.
UPDATE "Task"
SET "dueDateNotifiedAt" = now()
WHERE "dueDate" IS NOT NULL
  AND "dueDate" <= now();
