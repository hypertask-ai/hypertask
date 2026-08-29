-- This migration reconciles schema changes that reached production without a
-- committed migration. Every operation is safe when production already has
-- the current schema, while a fresh database receives the missing objects.

ALTER TYPE "TaskRelation" ADD VALUE IF NOT EXISTS 'Duplicate';

ALTER TABLE "ChatSession"
ADD COLUMN IF NOT EXISTS "taskId" INTEGER;

ALTER TABLE "Team"
ADD COLUMN IF NOT EXISTS "aiProviderSettings" JSONB;

ALTER TABLE "TimeEntry"
ADD COLUMN IF NOT EXISTS "note" TEXT;

ALTER TABLE "UserSetting"
ADD COLUMN IF NOT EXISTS "emojiFrequency" JSONB,
ADD COLUMN IF NOT EXISTS "muteAnnouncements" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS "ChatSession_taskId_idx" ON "ChatSession"("taskId");
CREATE INDEX IF NOT EXISTS "Task_projectId_status_idx" ON "Task"("projectId", "status");
CREATE INDEX IF NOT EXISTS "Task_parentTaskId_status_idx" ON "Task"("parentTaskId", "status");

DO $$
BEGIN
  IF to_regclass('"Task_agentTaskCreatedPendingAt_agentTaskCreatedReadyAt_agentTas"') IS NOT NULL
    AND to_regclass('"Task_agentTaskCreatedPendingAt_agentTaskCreatedReadyAt_agen_idx"') IS NULL THEN
    ALTER INDEX "Task_agentTaskCreatedPendingAt_agentTaskCreatedReadyAt_agentTas"
      RENAME TO "Task_agentTaskCreatedPendingAt_agentTaskCreatedReadyAt_agen_idx";
  END IF;
END $$;
