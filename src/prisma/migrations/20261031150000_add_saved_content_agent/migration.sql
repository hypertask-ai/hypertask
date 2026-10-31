ALTER TABLE "SavedContent" ADD COLUMN "agentId" TEXT;

CREATE INDEX "SavedContent_agentId_idx" ON "SavedContent"("agentId");

ALTER TABLE "SavedContent"
ADD CONSTRAINT "SavedContent_agentId_fkey"
FOREIGN KEY ("agentId") REFERENCES "Agent"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
