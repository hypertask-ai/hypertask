-- YPER4-215: retain the actor and reason for page and API flag mode changes.
CREATE TABLE IF NOT EXISTS "FeatureFlagChange" (
  "id" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "oldMode" "FeatureFlagMode",
  "newMode" "FeatureFlagMode" NOT NULL,
  "userId" INTEGER NOT NULL,
  "agentId" TEXT,
  "agentName" TEXT,
  "reason" TEXT,
  "source" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "FeatureFlagChange_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "FeatureFlagChange_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "FeatureFlagChange_key_createdAt_idx" ON "FeatureFlagChange"("key", "createdAt");
