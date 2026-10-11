-- HTPR-7122: an agent's emoji reaction is saved as the agent, never as its owner.
-- Additive and safe to re-run: two nullable columns, no default, no backfill, no index.
-- Reaction is written by every emoji click, so wait at most 2s for the table lock
-- per attempt instead of queueing reaction writes behind this change.
DO $$
DECLARE
  attempt INTEGER := 0;
BEGIN
  LOOP
    BEGIN
      PERFORM set_config('lock_timeout', '2s', true);
      ALTER TABLE "Reaction"
        ADD COLUMN IF NOT EXISTS "agentId" TEXT,
        ADD COLUMN IF NOT EXISTS "agentDisplayName" TEXT;
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
