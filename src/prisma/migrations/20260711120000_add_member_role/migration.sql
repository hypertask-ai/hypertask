-- CreateEnum
CREATE TYPE "MemberRole" AS ENUM ('Admin', 'Member');

-- AlterTable
ALTER TABLE "Member" ADD COLUMN     "role" "MemberRole" NOT NULL DEFAULT 'Member';
