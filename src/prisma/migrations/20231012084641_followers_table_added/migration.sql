-- AlterTable
ALTER TABLE "Notification" ALTER COLUMN "projectId" SET DEFAULT 1,
ALTER COLUMN "taskId" SET DEFAULT 1;

-- CreateTable
CREATE TABLE "Follower" (
    "id" TEXT NOT NULL,
    "mentionById" INTEGER,
    "taskId" INTEGER NOT NULL,
    "userId" INTEGER NOT NULL,
    "mentionAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Follower_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "Follower" ADD CONSTRAINT "Follower_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Follower" ADD CONSTRAINT "Follower_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
