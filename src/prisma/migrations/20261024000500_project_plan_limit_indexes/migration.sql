CREATE INDEX IF NOT EXISTS "Project_teamId_status_idx" ON "Project"("teamId", "status");
CREATE INDEX IF NOT EXISTS "Project_ownerId_teamId_status_idx" ON "Project"("ownerId", "teamId", "status");
