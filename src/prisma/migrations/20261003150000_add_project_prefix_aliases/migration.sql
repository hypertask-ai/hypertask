CREATE TABLE "ProjectPrefixAlias" (
    "id" SERIAL NOT NULL,
    "projectId" INTEGER NOT NULL,
    "prefix" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectPrefixAlias_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ProjectPrefixAlias_projectId_prefix_key" ON "ProjectPrefixAlias"("projectId", "prefix");
CREATE INDEX "ProjectPrefixAlias_prefix_idx" ON "ProjectPrefixAlias"("prefix");

ALTER TABLE "ProjectPrefixAlias" ADD CONSTRAINT "ProjectPrefixAlias_projectId_fkey"
    FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
