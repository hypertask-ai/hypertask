-- CreateEnum
CREATE TYPE "SortingMode" AS ENUM ('Manual', 'Priority');

-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "sorting_mode" "SortingMode" NOT NULL DEFAULT 'Manual';
