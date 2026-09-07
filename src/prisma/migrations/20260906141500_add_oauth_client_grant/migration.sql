-- HTPR-6200: remembered OAuth consent, one row per (user, connector).
CREATE TABLE "OAuthClientGrant" (
    "id" UUID NOT NULL,
    "user_id" INTEGER NOT NULL,
    "client_id" VARCHAR(64) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OAuthClientGrant_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "OAuthClientGrant_user_id_client_id_key" ON "OAuthClientGrant"("user_id", "client_id");

CREATE INDEX "OAuthClientGrant_client_id_idx" ON "OAuthClientGrant"("client_id");

ALTER TABLE "OAuthClientGrant"
ADD CONSTRAINT "OAuthClientGrant_user_id_fkey"
FOREIGN KEY ("user_id") REFERENCES "User"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "OAuthClientGrant"
ADD CONSTRAINT "OAuthClientGrant_client_id_fkey"
FOREIGN KEY ("client_id") REFERENCES "OAuthClient"("client_id")
ON DELETE CASCADE ON UPDATE CASCADE;
