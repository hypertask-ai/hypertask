CREATE TABLE "AnalyticsIntent" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AnalyticsIntent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AnalyticsIntent_key_key" ON "AnalyticsIntent"("key");
CREATE INDEX "AnalyticsIntent_processedAt_nextAttemptAt_idx" ON "AnalyticsIntent"("processedAt", "nextAttemptAt");
