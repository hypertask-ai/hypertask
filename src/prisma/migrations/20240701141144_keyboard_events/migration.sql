-- AlterEnum
ALTER TYPE "EventType" ADD VALUE 'UserAndTeamEvent';

-- AlterTable
ALTER TABLE "Events" ADD COLUMN     "keyboardShortcut" TEXT,
ADD COLUMN     "user_activity_id" INTEGER;

-- AddForeignKey
ALTER TABLE "Events" ADD CONSTRAINT "Events_user_activity_id_fkey" FOREIGN KEY ("user_activity_id") REFERENCES "User_Activity"("id") ON DELETE SET NULL ON UPDATE CASCADE;
