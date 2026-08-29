-- CreateEnum
CREATE TYPE "MentionPreference" AS ENUM ('all', 'direct', 'nothing');

-- AlterTable
ALTER TABLE "UserSetting" ADD COLUMN     "notificationPreference" "MentionPreference" NOT NULL DEFAULT 'all';
