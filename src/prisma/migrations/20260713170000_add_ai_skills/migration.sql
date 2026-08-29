-- CreateTable
CREATE TABLE "AI_Skill" (
    "id" SERIAL NOT NULL,
    "projectId" INTEGER,
    "userId" INTEGER,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "argumentHint" TEXT,
    "body" TEXT NOT NULL,
    "sourceUrl" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdById" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AI_Skill_pkey" PRIMARY KEY ("id")
);

-- A skill is EITHER personal (userId) OR project-shared (projectId), never both
-- and never neither. App code enforces this too; the constraint makes it permanent.
ALTER TABLE "AI_Skill" ADD CONSTRAINT "AI_Skill_scope_check"
  CHECK (("userId" IS NULL) <> ("projectId" IS NULL));

-- CreateIndex
CREATE UNIQUE INDEX "AI_Skill_projectId_slug_key" ON "AI_Skill"("projectId", "slug");

-- CreateIndex
CREATE UNIQUE INDEX "AI_Skill_userId_slug_key" ON "AI_Skill"("userId", "slug");

-- AddForeignKey
ALTER TABLE "AI_Skill" ADD CONSTRAINT "AI_Skill_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AI_Skill" ADD CONSTRAINT "AI_Skill_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AI_Skill" ADD CONSTRAINT "AI_Skill_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
