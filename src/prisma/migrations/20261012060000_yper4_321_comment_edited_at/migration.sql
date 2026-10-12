-- Nullable with no default or backfill: never-edited comments keep null edit metadata.
-- Bound lock waits so live comment writes are not queued behind this change.
DO $$
DECLARE
  attempt INTEGER := 0;
BEGIN
  LOOP
    BEGIN
      PERFORM set_config('lock_timeout', '2s', true);
      ALTER TABLE "Comment"
        ADD COLUMN IF NOT EXISTS "editedAt" TIMESTAMP(3),
        ADD COLUMN IF NOT EXISTS "editedByUserId" INTEGER,
        ADD COLUMN IF NOT EXISTS "editedByAgentId" TEXT;
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
