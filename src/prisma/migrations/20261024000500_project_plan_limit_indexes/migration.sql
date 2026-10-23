CREATE INDEX "Project_teamId_status_idx" ON "Project"("teamId", "status");
CREATE INDEX "Project_ownerId_teamId_status_idx" ON "Project"("ownerId", "teamId", "status");
