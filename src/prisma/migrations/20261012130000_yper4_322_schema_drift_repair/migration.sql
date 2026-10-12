-- YPER4-322: an existing cacheWriteInputTokens column was skipped by the
-- HTPR-7076 IF NOT EXISTS retry, preserving NOT NULL/default 0 instead of Int?.
-- Metadata-only repair: preserve all existing values and bound writer lock waits.
DO $$
DECLARE
  attempt INTEGER := 0;
BEGIN
  LOOP
    BEGIN
      PERFORM set_config('lock_timeout', '2s', true);
      IF EXISTS (
        SELECT FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'AiUsage'
          AND column_name = 'cacheWriteInputTokens'
          AND (is_nullable = 'NO' OR column_default IS NOT NULL)
      ) THEN
        ALTER TABLE IF EXISTS public."AiUsage"
          ALTER COLUMN "cacheWriteInputTokens" DROP NOT NULL,
          ALTER COLUMN "cacheWriteInputTokens" DROP DEFAULT;
      END IF;
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
