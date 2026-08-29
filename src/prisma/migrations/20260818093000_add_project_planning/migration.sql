-- Add project-level planning metadata and the two appendable planning records.
ALTER TABLE "Project" ADD COLUMN "targetDate" TIMESTAMP(3);

CREATE TYPE "ProjectHealth" AS ENUM ('OnTrack', 'AtRisk', 'OffTrack');

CREATE TABLE "ProjectMilestone" (
    "id" TEXT NOT NULL,
    "projectId" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "targetDate" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),
    "createdById" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectMilestone_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ProjectStatusUpdate" (
    "id" TEXT NOT NULL,
    "projectId" INTEGER NOT NULL,
    "health" "ProjectHealth" NOT NULL,
    "message" TEXT NOT NULL,
    "authorId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectStatusUpdate_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ProjectMilestone_projectId_targetDate_idx" ON "ProjectMilestone"("projectId", "targetDate");
CREATE INDEX "ProjectStatusUpdate_projectId_createdAt_idx" ON "ProjectStatusUpdate"("projectId", "createdAt");

ALTER TABLE "ProjectMilestone" ADD CONSTRAINT "ProjectMilestone_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProjectMilestone" ADD CONSTRAINT "ProjectMilestone_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProjectStatusUpdate" ADD CONSTRAINT "ProjectStatusUpdate_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProjectStatusUpdate" ADD CONSTRAINT "ProjectStatusUpdate_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
