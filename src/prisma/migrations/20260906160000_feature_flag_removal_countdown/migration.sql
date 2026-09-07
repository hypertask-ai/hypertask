ALTER TABLE "FeatureFlag" ADD COLUMN "releasedAt" TIMESTAMP(3);
ALTER TABLE "FeatureFlag" ADD COLUMN "keep" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "FeatureFlag" ADD COLUMN "removalTaskId" INTEGER;

-- Flags already on Everyone have no recorded switch date: "updatedAt" is the last write of any
-- kind, not the day the flag was released, and backdating from it would make several flags
-- instantly overdue and file a burst of removal tickets on the first sweep. Start their 14 days now.
-- AT TIME ZONE 'UTC' because the column is TIMESTAMP(3) without a zone and Prisma writes UTC
-- into it: a bare NOW() would be truncated using the migration session's timezone instead.
UPDATE "FeatureFlag" SET "releasedAt" = (NOW() AT TIME ZONE 'UTC') WHERE "mode" = 'EVERYONE';
