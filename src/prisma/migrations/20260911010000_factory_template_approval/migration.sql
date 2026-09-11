-- Empty opt-in policy storage; no project or requirement is approved here.
ALTER TABLE "FactoryContract" ADD COLUMN "templateVersion" INTEGER, ADD COLUMN "semanticVersion" INTEGER;

CREATE TABLE "FactoryTemplate" (
  "projectId" INTEGER NOT NULL,
  "version" INTEGER NOT NULL,
  "criteria" JSONB NOT NULL,
  "criteriaDigest" TEXT NOT NULL,
  "ownerId" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "FactoryTemplate_pkey" PRIMARY KEY ("projectId", "version")
);

CREATE TABLE "FactorySemanticReceipt" (
  "taskId" INTEGER NOT NULL,
  "version" INTEGER NOT NULL,
  "projectId" INTEGER NOT NULL,
  "criteria" JSONB NOT NULL,
  "criteriaDigest" TEXT NOT NULL,
  "taskContentDigest" TEXT NOT NULL,
  "sourceTaskRevision" TIMESTAMP(3),
  "ownerId" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "FactorySemanticReceipt_pkey" PRIMARY KEY ("taskId", "version")
);
CREATE INDEX "FactorySemanticReceipt_projectId_idx" ON "FactorySemanticReceipt"("projectId");
