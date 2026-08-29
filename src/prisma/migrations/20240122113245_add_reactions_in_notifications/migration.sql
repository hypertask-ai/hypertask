-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'Reacted';

-- AlterTable
ALTER TABLE "Notification" ADD COLUMN     "reactionId" TEXT;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_reactionId_fkey" FOREIGN KEY ("reactionId") REFERENCES "Reaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;
