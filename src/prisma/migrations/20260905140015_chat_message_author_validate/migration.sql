-- Validating a NOT VALID constraint scans ChatMessage under SHARE UPDATE
-- EXCLUSIVE, which lets reads and writes through, and no longer touches User
-- or Agent at all. Runs after the backfill: the two backfill statements write
-- disjoint rows, so no row can end up with both authors set.
ALTER TABLE "ChatMessage" VALIDATE CONSTRAINT "ChatMessage_author_check";
ALTER TABLE "ChatMessage" VALIDATE CONSTRAINT "ChatMessage_authorUserId_fkey";
ALTER TABLE "ChatMessage" VALIDATE CONSTRAINT "ChatMessage_authorAgentId_fkey";
