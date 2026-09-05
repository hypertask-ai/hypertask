-- Actor attribution for chat history: which person or which agent wrote a
-- message, which `role` alone cannot say. Both columns are nullable, so this
-- is an add-column only, no table rewrite.
--
-- Kept apart from its backfill, its validation and its indexes on purpose.
-- ADD COLUMN takes an ACCESS EXCLUSIVE lock on ChatMessage that Postgres holds
-- to the end of the transaction, so bundling the row rewrite and the index
-- builds in here would block every chat read and write for the whole deploy.
-- The constraints below are NOT VALID because a validated foreign key scans
-- all of ChatMessage under the ADD COLUMN lock. NOT VALID skips that scan; it
-- does not skip the brief SHARE ROW EXCLUSIVE these statements take on User
-- and Agent, which is unavoidable when adding a reference to them. Validation
-- happens in its own migration.
ALTER TABLE "ChatMessage" ADD COLUMN "authorUserId" INTEGER;
ALTER TABLE "ChatMessage" ADD COLUMN "authorAgentId" TEXT;

-- A message has one author at most. Machine-generated turns (the heartbeat
-- prompt, run system notices) and the built-in AI assistant have none.
ALTER TABLE "ChatMessage" ADD CONSTRAINT "ChatMessage_author_check"
  CHECK (NOT ("authorUserId" IS NOT NULL AND "authorAgentId" IS NOT NULL)) NOT VALID;

ALTER TABLE "ChatMessage" ADD CONSTRAINT "ChatMessage_authorUserId_fkey"
  FOREIGN KEY ("authorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE NOT VALID;
ALTER TABLE "ChatMessage" ADD CONSTRAINT "ChatMessage_authorAgentId_fkey"
  FOREIGN KEY ("authorAgentId") REFERENCES "Agent"("id") ON DELETE SET NULL ON UPDATE CASCADE NOT VALID;
