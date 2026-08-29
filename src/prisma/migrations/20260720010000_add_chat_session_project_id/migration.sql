-- AlterTable
ALTER TABLE "ChatSession" ADD COLUMN "projectId" INTEGER;

-- CreateIndex
CREATE INDEX "ChatSession_projectId_idx" ON "ChatSession"("projectId");
