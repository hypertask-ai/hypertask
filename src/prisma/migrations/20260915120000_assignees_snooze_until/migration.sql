-- HTPR-6461: per-user My Tasks snooze-until on the assignment row.
ALTER TABLE "Assignees" ADD COLUMN "snoozeUntil" TIMESTAMP(3);

-- Speeds My Tasks hide filter: current user's future snoozes.
CREATE INDEX "Assignees_userId_snoozeUntil_idx" ON "Assignees"("userId", "snoozeUntil");
