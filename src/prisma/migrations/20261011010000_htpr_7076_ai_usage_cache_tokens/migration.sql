-- HTPR-7076: record how many prompt tokens came from or went into the provider cache.
-- Safe to re-run. AiUsage is written constantly, so wait at most 2s for the table lock
-- per attempt instead of queueing every AiUsage query behind this change.
DO $$
DECLARE
  attempt INTEGER := 0;
BEGIN
  LOOP
    BEGIN
      PERFORM set_config('lock_timeout', '2s', true);
      ALTER TABLE "AiUsage"
        ADD COLUMN IF NOT EXISTS "cachedInputTokens" INTEGER,
        ADD COLUMN IF NOT EXISTS "cacheWriteInputTokens" INTEGER;
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
