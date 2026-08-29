-- CreateEnum
CREATE TYPE "EmptySections" AS ENUM ('Show', 'Hidden');

-- AlterTable
ALTER TABLE "View" ADD COLUMN     "board_empty_sections" "EmptySections" NOT NULL DEFAULT 'Show';
