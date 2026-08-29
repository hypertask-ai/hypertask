-- CreateIndex
CREATE INDEX "Notification_userId_status_agentId_createdAt_idx" ON "Notification"("userId", "status", "agentId", "createdAt");

-- CreateIndex
CREATE INDEX "Reminder_taskId_status_idx" ON "Reminder"("taskId", "status");
