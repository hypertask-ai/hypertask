BEGIN;

LOCK TABLE "Page" IN ACCESS EXCLUSIVE MODE;

CREATE TABLE IF NOT EXISTS "PageTaskLink" (
    "id" SERIAL NOT NULL,
    "pageId" INTEGER NOT NULL,
    "taskId" INTEGER NOT NULL,
    "createdById" INTEGER,
    "agentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "removedAt" TIMESTAMP(3),
    CONSTRAINT "PageTaskLink_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "PageTaskLink_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "Page"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PageTaskLink_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PageTaskLink_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "PageTaskLink_pageId_taskId_key" ON "PageTaskLink"("pageId", "taskId");
CREATE INDEX IF NOT EXISTS "PageTaskLink_taskId_idx" ON "PageTaskLink"("taskId");

ALTER TABLE "Page" DROP CONSTRAINT IF EXISTS "Page_taskId_fkey";
ALTER TABLE "Page" ALTER COLUMN "taskId" DROP NOT NULL;
ALTER TABLE "Page" ADD CONSTRAINT "Page_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE IF NOT EXISTS "_htpr7298_page_project_backup" (
    "id" INTEGER PRIMARY KEY,
    "projectId" INTEGER NOT NULL
);

INSERT INTO "_htpr7298_page_project_backup" ("id", "projectId")
SELECT p."id", p."projectId" FROM "Page" p
JOIN "Task" t ON p."taskId" = t."id"
WHERE p."projectId" <> t."projectId"
ON CONFLICT ("id") DO NOTHING;

UPDATE "Page" p SET "projectId" = t."projectId"
FROM "Task" t WHERE p."taskId" = t."id" AND p."projectId" <> t."projectId";

INSERT INTO "PageTaskLink" ("pageId", "taskId", "createdById", "agentId", "createdAt")
SELECT "id", "taskId", "createdById", "agentId", "createdAt" FROM "Page"
WHERE "taskId" IS NOT NULL
ON CONFLICT ("pageId", "taskId") DO NOTHING;

COMMIT;
