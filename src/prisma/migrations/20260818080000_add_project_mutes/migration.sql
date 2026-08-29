CREATE TABLE "ProjectMute" (
    "id" TEXT NOT NULL,
    "projectId" INTEGER NOT NULL,
    "userId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectMute_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ProjectMute_projectId_userId_key"
ON "ProjectMute"("projectId", "userId");

CREATE INDEX "ProjectMute_userId_idx" ON "ProjectMute"("userId");

ALTER TABLE "ProjectMute"
ADD CONSTRAINT "ProjectMute_projectId_fkey"
FOREIGN KEY ("projectId") REFERENCES "Project"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ProjectMute"
ADD CONSTRAINT "ProjectMute_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
