ALTER TABLE "Task" ADD COLUMN "blockerCommentId" INTEGER;

CREATE UNIQUE INDEX "Task_blockerCommentId_key" ON "Task"("blockerCommentId");

ALTER TABLE "Task" ADD CONSTRAINT "Task_blockerCommentId_fkey" FOREIGN KEY ("blockerCommentId") REFERENCES "Comment"("id") ON DELETE SET NULL ON UPDATE CASCADE;
