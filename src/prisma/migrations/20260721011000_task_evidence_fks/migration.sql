-- HTPR-4443 follow-up: add creator/agent FK constraints to TaskEvidence,
-- matching the Comment model. Table is empty, so no orphan rows to violate.
ALTER TABLE "TaskEvidence" ADD CONSTRAINT "TaskEvidence_creatorId_fkey"
    FOREIGN KEY ("creatorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "TaskEvidence" ADD CONSTRAINT "TaskEvidence_agentId_fkey"
    FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE SET NULL ON UPDATE CASCADE;
