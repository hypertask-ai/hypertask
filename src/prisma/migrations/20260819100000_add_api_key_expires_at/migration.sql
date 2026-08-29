-- Adds an optional expiry to REST API keys (htk_) so they can be issued with a
-- lifetime instead of living forever. NULL keeps the existing "never expires"
-- behaviour for every key issued before this migration.
ALTER TABLE "ApiKey" ADD COLUMN "expiresAt" TIMESTAMP(3);
