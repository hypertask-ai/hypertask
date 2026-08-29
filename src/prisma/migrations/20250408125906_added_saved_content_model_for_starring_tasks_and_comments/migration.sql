-- CreateTable
CREATE TABLE "SavedContent" (
    "id" TEXT NOT NULL,
    "userId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "taskId" INTEGER NOT NULL,
    "commentId" INTEGER,
    "projectId" INTEGER NOT NULL,
    "type" "ViewVisibility" NOT NULL DEFAULT 'Private',

    CONSTRAINT "SavedContent_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "SavedContent" ADD CONSTRAINT "SavedContent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SavedContent" ADD CONSTRAINT "SavedContent_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SavedContent" ADD CONSTRAINT "SavedContent_commentId_fkey" FOREIGN KEY ("commentId") REFERENCES "Comment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SavedContent" ADD CONSTRAINT "SavedContent_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
