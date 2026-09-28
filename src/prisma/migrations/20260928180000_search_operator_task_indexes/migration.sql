CREATE INDEX CONCURRENTLY IF NOT EXISTS "Task_projectId_status_userId_idx" ON "Task"("projectId", "status", "userId");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "Task_projectId_status_createdAt_idx" ON "Task"("projectId", "status", "createdAt");
