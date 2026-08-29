-- HTPR-4340 phase 1: account-scoped management API keys.

CREATE TABLE "BetterAuthApiKey" (
    "id" SERIAL NOT NULL,
    "configId" TEXT NOT NULL DEFAULT 'default',
    "name" TEXT,
    "start" TEXT,
    "prefix" TEXT,
    "key" TEXT NOT NULL,
    "userId" INTEGER NOT NULL,
    "refillInterval" INTEGER,
    "refillAmount" INTEGER,
    "lastRefillAt" TIMESTAMP(3),
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "rateLimitEnabled" BOOLEAN NOT NULL DEFAULT true,
    "rateLimitTimeWindow" INTEGER,
    "rateLimitMax" INTEGER,
    "requestCount" INTEGER NOT NULL DEFAULT 0,
    "remaining" INTEGER,
    "lastRequest" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "permissions" TEXT,
    "metadata" TEXT,

    CONSTRAINT "BetterAuthApiKey_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "BetterAuthApiKey_configId_idx" ON "BetterAuthApiKey"("configId");
CREATE INDEX "BetterAuthApiKey_key_idx" ON "BetterAuthApiKey"("key");
CREATE INDEX "BetterAuthApiKey_userId_idx" ON "BetterAuthApiKey"("userId");

ALTER TABLE "BetterAuthApiKey" ADD CONSTRAINT "BetterAuthApiKey_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
