-- Null preserves every existing account-wide key. CASCADE is deliberate:
-- deleting a team must revoke its keys, never widen them to account scope.
ALTER TABLE "BetterAuthApiKey"
  ADD COLUMN "teamId" TEXT,
  ADD COLUMN "teamAccessBinding" TEXT;

CREATE INDEX "BetterAuthApiKey_userId_teamId_idx"
  ON "BetterAuthApiKey"("userId", "teamId");

CREATE INDEX "BetterAuthApiKey_teamId_idx"
  ON "BetterAuthApiKey"("teamId");

ALTER TABLE "BetterAuthApiKey"
  ADD CONSTRAINT "BetterAuthApiKey_teamId_fkey"
  FOREIGN KEY ("teamId") REFERENCES "Team"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
