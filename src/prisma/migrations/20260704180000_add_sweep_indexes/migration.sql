-- Indexes backing the minute-ly sweep (src/pages/api/queues/sweep.ts) so its WHERE
-- clauses use an index instead of full-scanning every tick. Names match Prisma's
-- @@index defaults so the schema stays in sync (no drift on the next migrate).
--
-- NOTE: plain CREATE INDEX takes a brief write lock while it builds. On a large live
-- "Task" table, run these as CREATE INDEX CONCURRENTLY by hand instead (cannot run
-- inside a migration transaction). IF NOT EXISTS makes that pre-creation a no-op here.
CREATE INDEX IF NOT EXISTS "Task_status_permanentlyDeleteAt_idx" ON "Task"("status", "permanentlyDeleteAt");
CREATE INDEX IF NOT EXISTS "Task_dueDate_dueDateNotifiedAt_idx" ON "Task"("dueDate", "dueDateNotifiedAt");
CREATE INDEX IF NOT EXISTS "Reminder_status_remindAt_idx" ON "Reminder"("status", "remindAt");
CREATE INDEX IF NOT EXISTS "ChatSession_updatedAt_idx" ON "ChatSession"("updatedAt");
