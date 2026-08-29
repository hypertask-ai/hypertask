-- AlterTable
ALTER TABLE "Team_Activity" ALTER COLUMN "lastActiviyAt" DROP NOT NULL,
ALTER COLUMN "lastActiviyAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "User_Activity" ALTER COLUMN "lastActiveAt" DROP NOT NULL,
ALTER COLUMN "lastActiveAt" DROP DEFAULT;
