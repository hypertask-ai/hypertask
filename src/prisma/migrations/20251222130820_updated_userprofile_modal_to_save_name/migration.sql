-- AlterTable
ALTER TABLE "UserPicture" ADD COLUMN     "displayName" TEXT,
ADD COLUMN     "nameSet" BOOLEAN NOT NULL DEFAULT false;
