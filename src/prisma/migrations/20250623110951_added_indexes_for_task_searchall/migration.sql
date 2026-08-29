-- CreateIndex
CREATE INDEX "Comment_taskId_creatorId_idx" ON "Comment"("taskId", "creatorId");

-- CreateIndex
CREATE INDEX "Task_projectId_deletedAt_updatedAt_idx" ON "Task"("projectId", "deletedAt", "updatedAt");

-- CreateIndex
CREATE INDEX "Task_updatedAt_idx" ON "Task"("updatedAt");

-- CreateIndex
CREATE INDEX "Task_deletedAt_idx" ON "Task"("deletedAt");

-- CreateIndex
CREATE INDEX "Task_status_idx" ON "Task"("status");
