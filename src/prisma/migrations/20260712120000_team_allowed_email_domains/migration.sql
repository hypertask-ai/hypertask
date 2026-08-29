-- AlterTable
ALTER TABLE "Team" ADD COLUMN "allowedEmailDomains" TEXT[] DEFAULT ARRAY[]::TEXT[];
