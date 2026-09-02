ALTER TABLE "OAuthClient" ADD COLUMN "owner_id" INTEGER;

WITH ownership_candidates AS (
  SELECT "client_id", "user_id", "createdAt"
  FROM "OAuthAuthorizationCode"
  WHERE "used" = true
  UNION ALL
  SELECT "clientId" AS "client_id", "userId" AS "user_id", "createdAt"
  FROM "OAuthRefreshToken"
), first_owners AS (
  SELECT DISTINCT ON ("client_id") "client_id", "user_id"
  FROM ownership_candidates
  ORDER BY "client_id", "createdAt" ASC, "user_id" ASC
)
UPDATE "OAuthClient" AS client
SET "owner_id" = first_owners."user_id"
FROM first_owners
WHERE client."client_id" = first_owners."client_id";

CREATE INDEX "OAuthClient_owner_id_idx" ON "OAuthClient"("owner_id");

ALTER TABLE "OAuthClient"
ADD CONSTRAINT "OAuthClient_owner_id_fkey"
FOREIGN KEY ("owner_id") REFERENCES "User"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
