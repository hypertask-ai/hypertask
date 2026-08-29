-- CreateEnum
CREATE TYPE "SubtaskSetting" AS ENUM ('None', 'Parent', 'Flattened', 'Card');

-- AlterTable
ALTER TABLE "Task" ADD COLUMN     "parentTaskId" INTEGER;

-- AlterTable
ALTER TABLE "View" ADD COLUMN     "board_subtask_setting" "SubtaskSetting" NOT NULL DEFAULT 'None';

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_parentTaskId_fkey" FOREIGN KEY ("parentTaskId") REFERENCES "Task"("id") ON DELETE SET NULL ON UPDATE CASCADE;
