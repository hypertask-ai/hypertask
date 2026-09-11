-- Opt-in storage only. Enrollment is owner-controlled; no project is enabled here.


-- CreateTable
CREATE TABLE "FactoryEnrollment" (
    "projectId" INTEGER NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "version" INTEGER NOT NULL DEFAULT 1,
    "agentRoles" JSONB NOT NULL,
    "sections" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FactoryEnrollment_pkey" PRIMARY KEY ("projectId")
);

-- CreateTable
CREATE TABLE "FactoryContract" (
    "taskId" INTEGER NOT NULL,
    "version" INTEGER NOT NULL,
    "projectId" INTEGER NOT NULL,
    "criteria" JSONB NOT NULL,
    "criteriaDigest" TEXT NOT NULL,
    "ownerId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FactoryContract_pkey" PRIMARY KEY ("taskId","version")
);

-- CreateTable
CREATE TABLE "FactoryRevision" (
    "taskId" INTEGER NOT NULL,
    "projectId" INTEGER NOT NULL,
    "contractVersion" INTEGER NOT NULL,
    "codeRevision" TEXT NOT NULL,
    "activeWriterAgentId" TEXT NOT NULL,
    "implementerAgentIds" JSONB NOT NULL,
    "epoch" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "FactoryRevision_pkey" PRIMARY KEY ("taskId")
);

-- CreateTable
CREATE TABLE "FactoryGrant" (
    "requestId" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "authorizationId" TEXT NOT NULL,
    "projectId" INTEGER NOT NULL,
    "taskId" INTEGER NOT NULL,
    "actorAgentId" TEXT NOT NULL,
    "authorityAgentId" TEXT NOT NULL,
    "enrollmentVersion" INTEGER NOT NULL,
    "contractVersion" INTEGER NOT NULL,
    "revisionEpoch" INTEGER NOT NULL,
    "codeRevision" TEXT NOT NULL,
    "targetSectionId" INTEGER NOT NULL,
    "expectedTaskRevision" TIMESTAMP(3) NOT NULL,
    "evidenceDigest" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "consumedTaskRevision" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FactoryGrant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FactoryTransitionRequest" (
    "id" TEXT NOT NULL,
    "requestKey" TEXT NOT NULL,
    "enrollmentVersion" INTEGER NOT NULL,
    "projectId" INTEGER NOT NULL,
    "taskId" INTEGER NOT NULL,
    "actorAgentId" TEXT NOT NULL,
    "targetSectionId" INTEGER NOT NULL,
    "expectedTaskRevision" TIMESTAMP(3) NOT NULL,
    "contractVersion" INTEGER NOT NULL,
    "codeRevision" TEXT NOT NULL,
    "revisionEpoch" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "grantId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FactoryTransitionRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FactoryGrant_taskId_actorAgentId_targetSectionId_consumedAt_idx" ON "FactoryGrant"("taskId", "actorAgentId", "targetSectionId", "consumedAt");

-- CreateIndex
CREATE UNIQUE INDEX "FactoryGrant_projectId_authorizationId_key" ON "FactoryGrant"("projectId", "authorizationId");

-- CreateIndex
CREATE UNIQUE INDEX "FactoryTransitionRequest_requestKey_key" ON "FactoryTransitionRequest"("requestKey");

-- CreateIndex
CREATE INDEX "FactoryTransitionRequest_projectId_status_createdAt_idx" ON "FactoryTransitionRequest"("projectId", "status", "createdAt");
