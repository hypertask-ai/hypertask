CREATE TABLE "OAuthRefreshToken" (
    "id" UUID NOT NULL,
    "familyId" UUID NOT NULL,
    "tokenHash" VARCHAR(64) NOT NULL,
    "clientId" VARCHAR(64) NOT NULL,
    "userId" INTEGER NOT NULL,
    "firebaseUid" VARCHAR(128) NOT NULL,
    "accessTokenJti" VARCHAR(64) NOT NULL,
    "accessTokenExpiresAt" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "replacedByHash" VARCHAR(64),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OAuthRefreshToken_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "OAuthRefreshToken_tokenHash_key" ON "OAuthRefreshToken"("tokenHash");
CREATE INDEX "OAuthRefreshToken_clientId_idx" ON "OAuthRefreshToken"("clientId");
CREATE INDEX "OAuthRefreshToken_familyId_revokedAt_idx" ON "OAuthRefreshToken"("familyId", "revokedAt");
CREATE INDEX "OAuthRefreshToken_userId_revokedAt_idx" ON "OAuthRefreshToken"("userId", "revokedAt");
CREATE INDEX "OAuthRefreshToken_expiresAt_idx" ON "OAuthRefreshToken"("expiresAt");

ALTER TABLE "OAuthRefreshToken"
ADD CONSTRAINT "OAuthRefreshToken_clientId_fkey"
FOREIGN KEY ("clientId") REFERENCES "OAuthClient"("client_id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "OAuthRefreshToken"
ADD CONSTRAINT "OAuthRefreshToken_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
