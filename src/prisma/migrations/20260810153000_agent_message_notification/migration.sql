-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'AgentMessage';

-- AlterTable
ALTER TABLE "Notification" ADD COLUMN     "message" TEXT;
