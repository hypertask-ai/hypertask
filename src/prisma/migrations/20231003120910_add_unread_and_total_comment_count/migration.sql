-- AlterTable
ALTER TABLE "Task" ADD COLUMN     "totalComments" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "ReadStatus" (
    "id" TEXT NOT NULL,
    "taskId" INTEGER NOT NULL,
    "unreadCount" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ReadStatus_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ReadStatus_taskId_key" ON "ReadStatus"("taskId");

-- AddForeignKey
ALTER TABLE "ReadStatus" ADD CONSTRAINT "ReadStatus_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
