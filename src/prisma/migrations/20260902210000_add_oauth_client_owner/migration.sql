ALTER TABLE "OAuthClient" ADD COLUMN "owner_id" INTEGER;

CREATE INDEX "OAuthClient_owner_id_idx" ON "OAuthClient"("owner_id");

ALTER TABLE "OAuthClient"
ADD CONSTRAINT "OAuthClient_owner_id_fkey"
FOREIGN KEY ("owner_id") REFERENCES "User"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
