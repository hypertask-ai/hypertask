-- HTPR-7140: repair databases where the earlier nullable-user migration was marked
-- applied without dropping NOT NULL. Safe to re-run on an already nullable column.
-- AiUsage is written constantly, so wait at most 2s for its lock per attempt.
DO $$
DECLARE
  attempt INTEGER := 0;
BEGIN
  LOOP
    BEGIN
      PERFORM set_config('lock_timeout', '2s', true);
      ALTER TABLE "AiUsage" ALTER COLUMN "userId" DROP NOT NULL;
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
