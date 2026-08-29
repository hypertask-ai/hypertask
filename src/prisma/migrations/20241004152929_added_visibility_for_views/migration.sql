-- CreateEnum
CREATE TYPE "ViewVisibility" AS ENUM ('Public', 'Private');

-- AlterTable
ALTER TABLE "View" ADD COLUMN     "visibility" "ViewVisibility" NOT NULL DEFAULT 'Public';
