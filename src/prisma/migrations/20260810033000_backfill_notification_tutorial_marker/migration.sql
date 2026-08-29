-- Preserve the additive tutorialKey column for rolling rollback safety, but
-- convert any rows written by the short-lived implementation to the marker
-- understood by the schema-independent runtime.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'Notification'
      AND column_name = 'tutorialKey'
  ) THEN
    EXECUTE '
      UPDATE "Notification"
      SET "returnedFromReminders" = false
      WHERE "tutorialKey" LIKE ''learn-inbox-v1:user=%:project=%:task=%''
        AND "returnedFromReminders" IS NULL
    ';
  END IF;
END $$;
