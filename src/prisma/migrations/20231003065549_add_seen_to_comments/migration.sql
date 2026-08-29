-- AlterTable
ALTER TABLE "Comment" ADD COLUMN     "seen" INTEGER[] DEFAULT ARRAY[]::INTEGER[];
