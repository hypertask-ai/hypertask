-- HTPR-4857: lets delayed app_uninstalled / tokens_revoked events skip installs
-- that were reinstalled after the event happened. Prisma @updatedAt keeps the
-- value client-side, so the column ends with no database default.
ALTER TABLE "SlackInstall" ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
UPDATE "SlackInstall" SET "updatedAt" = "createdAt";
ALTER TABLE "SlackInstall" ALTER COLUMN "updatedAt" DROP DEFAULT;
