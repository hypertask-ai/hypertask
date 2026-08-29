-- CreateTable
CREATE TABLE "Task_Summary" (
    "id" SERIAL NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3),
    "content" TEXT NOT NULL,
    "taskId" INTEGER NOT NULL,

    CONSTRAINT "Task_Summary_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "Task_Summary" ADD CONSTRAINT "Task_Summary_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
