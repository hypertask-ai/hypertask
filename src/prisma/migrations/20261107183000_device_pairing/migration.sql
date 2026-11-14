CREATE TYPE "DevicePairingState" AS ENUM ('PENDING', 'CLAIMED', 'APPROVED', 'DELIVERED', 'CONNECTED', 'DENIED');
CREATE TABLE "DevicePairing" (
  "id" TEXT NOT NULL,
  "ownerId" INTEGER NOT NULL,
  "codeHash" VARCHAR(64) NOT NULL,
  "browserHash" VARCHAR(64) NOT NULL,
  "state" "DevicePairingState" NOT NULL DEFAULT 'PENDING',
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "challenge" VARCHAR(43),
  "claimantHash" VARCHAR(64),
  "clientName" VARCHAR(60),
  "oauthClientId" VARCHAR(64),
  "oauthRedirectUri" VARCHAR(512),
  "oauthCodeHash" VARCHAR(64),
  "agentId" TEXT,
  "teamId" TEXT,
  "projectId" INTEGER,
  "tokenGeneration" TEXT,
  "credential" TEXT,
  "deliveryResult" TEXT,
  "deliveryRetryUntil" TIMESTAMP(3),
  CONSTRAINT "DevicePairing_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "DevicePairing_codeHash_key" ON "DevicePairing"("codeHash");
CREATE UNIQUE INDEX "DevicePairing_agentId_key" ON "DevicePairing"("agentId");
CREATE INDEX "DevicePairing_ownerId_browserHash_expiresAt_idx" ON "DevicePairing"("ownerId", "browserHash", "expiresAt");
CREATE INDEX "DevicePairing_expiresAt_idx" ON "DevicePairing"("expiresAt");
ALTER TABLE "Agent" ADD COLUMN "devicePairingId" TEXT;
CREATE UNIQUE INDEX "Agent_devicePairingId_key" ON "Agent"("devicePairingId");
ALTER TABLE "Agent" ADD CONSTRAINT "Agent_devicePairingId_fkey" FOREIGN KEY ("devicePairingId") REFERENCES "DevicePairing"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "OAuthAuthorizationCode" ADD COLUMN "devicePairingId" TEXT;
ALTER TABLE "OAuthAuthorizationCode" ADD CONSTRAINT "OAuthAuthorizationCode_devicePairingId_fkey" FOREIGN KEY ("devicePairingId") REFERENCES "DevicePairing"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DevicePairing" ADD CONSTRAINT "DevicePairing_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE SET NULL ON UPDATE CASCADE;
