-- AlterTable
ALTER TABLE "Agent" ADD COLUMN     "mcpToken" TEXT,
ADD COLUMN     "mcpTokenExpiresAt" TIMESTAMP(3);
