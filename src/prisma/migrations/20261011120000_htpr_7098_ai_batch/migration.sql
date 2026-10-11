-- HTPR-7098: queue of background AI requests sent through the Batch API.
-- Safe to re-run: every statement is IF NOT EXISTS, and the one ALTER on an existing table waits
-- at most 2s for its lock per attempt instead of queueing other queries behind it.
CREATE TABLE IF NOT EXISTS "AiBatch" (
  "id" TEXT NOT NULL,
  "gatewayBatchId" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "teamId" TEXT NOT NULL,
  "userId" INTEGER NOT NULL,
  "model" TEXT NOT NULL,
  "items" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMP(3),
  CONSTRAINT "AiBatch_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "AiBatch_gatewayBatchId_key" ON "AiBatch"("gatewayBatchId");
CREATE INDEX IF NOT EXISTS "AiBatch_status_createdAt_idx" ON "AiBatch"("status", "createdAt");

DO $$
DECLARE
  attempt INTEGER := 0;
BEGIN
  LOOP
    BEGIN
      PERFORM set_config('lock_timeout', '2s', true);
      ALTER TABLE "SlackWatchedThread" ADD COLUMN IF NOT EXISTS "summaryBatchId" TEXT;
      EXIT;
    EXCEPTION WHEN lock_not_available THEN
      attempt := attempt + 1;
      IF attempt >= 20 THEN
        RAISE;
      END IF;
      PERFORM pg_sleep(1);
    END;
  END LOOP;
END $$;
