-- DropForeignKey
ALTER TABLE "Attachment" DROP CONSTRAINT "Attachment_taskId_fkey";

-- AlterTable
ALTER TABLE "Attachment" ADD COLUMN     "AI_Custom_Instructions_id" INTEGER,
ALTER COLUMN "taskId" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_AI_Custom_Instructions_id_fkey" FOREIGN KEY ("AI_Custom_Instructions_id") REFERENCES "AI_Custom_Instructions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE SET NULL ON UPDATE CASCADE;
