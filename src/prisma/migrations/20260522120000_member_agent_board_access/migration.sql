-- AlterTable
ALTER TABLE "Member" ADD COLUMN IF NOT EXISTS "agentId" TEXT;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "Member" ADD CONSTRAINT "Member_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "Member_projectId_agentId_key" ON "Member"("projectId", "agentId");
