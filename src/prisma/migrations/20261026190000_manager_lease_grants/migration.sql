CREATE TABLE "ManagerLeaseGrant" (
    "id" SERIAL NOT NULL,
    "agentId" TEXT NOT NULL,
    "session" VARCHAR(100) NOT NULL,
    "tokenHash" VARCHAR(64) NOT NULL,
    "ttlMinutes" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "renewedAt" TIMESTAMP(3),
    "replacedAt" TIMESTAMP(3),
    "releasedAt" TIMESTAMP(3),
    "endedReason" VARCHAR(20),

    CONSTRAINT "ManagerLeaseGrant_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ManagerLeaseGrant_tokenHash_key" ON "ManagerLeaseGrant"("tokenHash");

CREATE INDEX "ManagerLeaseGrant_agentId_expiresAt_idx" ON "ManagerLeaseGrant"("agentId", "expiresAt");
