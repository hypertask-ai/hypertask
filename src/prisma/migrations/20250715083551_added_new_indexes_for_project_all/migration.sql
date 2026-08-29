-- CreateIndex
CREATE INDEX "Assignees_taskId_idx" ON "Assignees"("taskId");

-- CreateIndex
CREATE INDEX "Member_userId_projectId_idx" ON "Member"("userId", "projectId");

-- CreateIndex
CREATE INDEX "Notification_taskId_userId_status_createdAt_idx" ON "Notification"("taskId", "userId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "Project_status_teamId_idx" ON "Project"("status", "teamId");

-- CreateIndex
CREATE INDEX "Project_ownerId_status_idx" ON "Project"("ownerId", "status");

-- CreateIndex
CREATE INDEX "SavedContent_taskId_userId_commentId_idx" ON "SavedContent"("taskId", "userId", "commentId");

-- CreateIndex
CREATE INDEX "Section_projectId_deleted_ranking_idx" ON "Section"("projectId", "deleted", "ranking");

-- CreateIndex
CREATE INDEX "Task_projectId_status_idx" ON "Task"("projectId", "status");

-- CreateIndex
CREATE INDEX "Task_parentTaskId_status_idx" ON "Task"("parentTaskId", "status");

-- CreateIndex
CREATE INDEX "User_Project_View_userId_project_view_id_idx" ON "User_Project_View"("userId", "project_view_id");

-- CreateIndex
CREATE INDEX "View_project_view_id_visibility_idx" ON "View"("project_view_id", "visibility");

-- CreateIndex
CREATE INDEX "View_userId_visibility_idx" ON "View"("userId", "visibility");
