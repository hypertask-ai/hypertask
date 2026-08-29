-- CreateEnum
CREATE TYPE "TaskShareType" AS ENUM ('Anyone', 'Domain');

-- CreateTable
CREATE TABLE "TaskSharing" (
    "id" TEXT NOT NULL,
    "userId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiredAt" TIMESTAMP(3),
    "taskId" INTEGER NOT NULL,
    "projectId" INTEGER NOT NULL,
    "expired" BOOLEAN NOT NULL DEFAULT false,
    "shareType" "TaskShareType" NOT NULL DEFAULT 'Anyone',

    CONSTRAINT "TaskSharing_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "TaskSharing" ADD CONSTRAINT "TaskSharing_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskSharing" ADD CONSTRAINT "TaskSharing_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskSharing" ADD CONSTRAINT "TaskSharing_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
