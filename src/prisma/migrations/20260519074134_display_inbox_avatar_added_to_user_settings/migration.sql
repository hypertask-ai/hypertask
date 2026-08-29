-- CreateEnum
CREATE TYPE "DisplayAvatar" AS ENUM ('Show', 'Hidden');

-- AlterTable
ALTER TABLE "UserSetting" ADD COLUMN     "displayAvatar" "DisplayAvatar" NOT NULL DEFAULT 'Hidden';
