-- CreateIndex
-- (already applied to prod via CREATE INDEX CONCURRENTLY on 2026-07-07; IF NOT
-- EXISTS keeps migrate deploy idempotent against that manual application)
CREATE INDEX IF NOT EXISTS "Task_ticketNumber_idx" ON "Task"("ticketNumber");
