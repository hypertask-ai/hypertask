-- HTPR-4331: per-task mute + per-category notification matrix.
-- Additive only: a new table and a new column with a default, so existing
-- rows and the currently deployed code are unaffected.

CREATE TABLE IF NOT EXISTS "TaskMute" (
    "id" TEXT NOT NULL,
    "taskId" INTEGER NOT NULL,
    "userId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TaskMute_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "TaskMute_taskId_userId_key" ON "TaskMute"("taskId", "userId");

ALTER TABLE "TaskMute" ADD CONSTRAINT "TaskMute_taskId_fkey"
    FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "TaskMute" ADD CONSTRAINT "TaskMute_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "UserSetting" ADD COLUMN IF NOT EXISTS "notificationMatrix" JSONB NOT NULL DEFAULT '{}';
