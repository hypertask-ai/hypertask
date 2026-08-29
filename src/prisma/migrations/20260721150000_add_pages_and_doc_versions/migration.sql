-- HTPR-4514: task pages and immutable document-version snapshots.
-- New tables, indexes, and foreign keys. Touches no existing table's data.
CREATE TABLE "Page" (
    "id" SERIAL NOT NULL,
    "publicId" TEXT NOT NULL,
    "title" TEXT NOT NULL DEFAULT 'Untitled',
    "contentHtml" TEXT NOT NULL DEFAULT '',
    "contentText" TEXT NOT NULL DEFAULT '',
    "taskId" INTEGER NOT NULL,
    "parentPageId" INTEGER,
    "projectId" INTEGER NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdById" INTEGER NOT NULL,
    "agentId" TEXT,
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3),
    CONSTRAINT "Page_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DocVersion" (
    "id" SERIAL NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" INTEGER NOT NULL,
    "version" INTEGER NOT NULL,
    "contentHtml" TEXT NOT NULL DEFAULT '',
    "contentText" TEXT NOT NULL DEFAULT '',
    "title" TEXT,
    "authorId" INTEGER,
    "agentId" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DocVersion_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Page_publicId_key" ON "Page"("publicId");
CREATE INDEX "Page_taskId_archived_idx" ON "Page"("taskId", "archived");
CREATE INDEX "Page_projectId_idx" ON "Page"("projectId");
CREATE INDEX "Page_parentPageId_idx" ON "Page"("parentPageId");
CREATE INDEX "DocVersion_entityType_entityId_version_idx" ON "DocVersion"("entityType", "entityId", "version");

ALTER TABLE "Page" ADD CONSTRAINT "Page_taskId_fkey"
    FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Page" ADD CONSTRAINT "Page_parentPageId_fkey"
    FOREIGN KEY ("parentPageId") REFERENCES "Page"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Page" ADD CONSTRAINT "Page_projectId_fkey"
    FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Page" ADD CONSTRAINT "Page_createdById_fkey"
    FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Page" ADD CONSTRAINT "Page_agentId_fkey"
    FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "DocVersion" ADD CONSTRAINT "DocVersion_authorId_fkey"
    FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
