-- Null keeps existing management keys account-wide. Deleting a team revokes
-- its scoped keys rather than widening them to account access.
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

ALTER TABLE "Team"
  ADD COLUMN "managementKeyOwnerGeneration" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "Member_Team"
  ADD COLUMN "managementKeyAccessGeneration" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "Agent"
  ADD COLUMN "credentialTeamId" TEXT,
  ADD COLUMN "credentialTeamAccessBinding" TEXT;

ALTER TABLE "BetterAuthApiKey"
  ADD CONSTRAINT "BetterAuthApiKey_teamScope_check"
  CHECK (("teamId" IS NULL) = ("teamAccessBinding" IS NULL));

ALTER TABLE "Agent"
  ADD CONSTRAINT "Agent_credentialTeamScope_check"
  CHECK (("credentialTeamId" IS NULL) = ("credentialTeamAccessBinding" IS NULL));

CREATE FUNCTION "incrementManagementKeyOwnerGeneration"()
RETURNS TRIGGER AS $$
BEGIN
  NEW."managementKeyOwnerGeneration" := OLD."managementKeyOwnerGeneration" + 1;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "Team_managementKeyOwnerGeneration_trigger"
BEFORE UPDATE OF "googleAccountId" ON "Team"
FOR EACH ROW
WHEN (OLD."googleAccountId" IS DISTINCT FROM NEW."googleAccountId")
EXECUTE FUNCTION "incrementManagementKeyOwnerGeneration"();

CREATE FUNCTION "incrementManagementKeyOwnerGenerationForAccount"()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE "Team"
  SET "managementKeyOwnerGeneration" = "managementKeyOwnerGeneration" + 1
  WHERE "googleAccountId" = NEW."id";
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "GoogleAccount_managementKeyOwnerGeneration_trigger"
AFTER UPDATE OF "userId" ON "GoogleAccount"
FOR EACH ROW
WHEN (OLD."userId" IS DISTINCT FROM NEW."userId")
EXECUTE FUNCTION "incrementManagementKeyOwnerGenerationForAccount"();

CREATE FUNCTION "incrementManagementKeyMemberGeneration"()
RETURNS TRIGGER AS $$
BEGIN
  NEW."managementKeyAccessGeneration" := OLD."managementKeyAccessGeneration" + 1;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "Member_Team_managementKeyAccessGeneration_trigger"
BEFORE UPDATE OF "status", "userId", "teamId" ON "Member_Team"
FOR EACH ROW
WHEN (
  OLD."status" IS DISTINCT FROM NEW."status"
  OR OLD."userId" IS DISTINCT FROM NEW."userId"
  OR OLD."teamId" IS DISTINCT FROM NEW."teamId"
)
EXECUTE FUNCTION "incrementManagementKeyMemberGeneration"();
