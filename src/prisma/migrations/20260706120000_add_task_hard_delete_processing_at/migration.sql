-- Processing marker for the hard-delete sweep. Claimed rows get this timestamp
-- before side effects run, so overlapping sweeps skip them; stale claims are
-- retryable from application code.
ALTER TABLE "Task" ADD COLUMN "hardDeleteProcessingAt" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "Task_status_permanentlyDeleteAt_hardDeleteProcessingAt_idx"
  ON "Task"("status", "permanentlyDeleteAt", "hardDeleteProcessingAt");
