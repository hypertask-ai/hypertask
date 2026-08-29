-- HTPR-4819: track when a task is waiting on a person.
ALTER TABLE "Task"
ADD COLUMN "waitingOnUserId" INTEGER,
ADD COLUMN "waitingOnSetById" INTEGER,
ADD COLUMN "waitingOnSetAt" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "Task_waitingOnUserId_idx" ON "Task"("waitingOnUserId");
