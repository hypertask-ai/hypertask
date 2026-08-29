-- DropForeignKey
ALTER TABLE "Comment" DROP CONSTRAINT "Comment_creatorId_fkey";

-- AlterTable
ALTER TABLE "Comment" ADD COLUMN     "activity" JSONB,
ALTER COLUMN "creatorId" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "Comment" ADD CONSTRAINT "Comment_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
