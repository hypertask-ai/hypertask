-- The Calendar_View table was deployed additively before the application
-- model. Normalize any impossible NULL rows, then align the column with the
-- non-null Prisma `Int[]` field before the feature starts writing data.
UPDATE "Calendar_View"
SET "projectIds" = ARRAY[]::INTEGER[]
WHERE "projectIds" IS NULL;

ALTER TABLE "Calendar_View"
ALTER COLUMN "projectIds" SET NOT NULL;
