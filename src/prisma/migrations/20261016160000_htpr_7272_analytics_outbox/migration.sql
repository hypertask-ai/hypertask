CREATE TABLE "AnalyticsOutbox" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "userId" INTEGER NOT NULL,
    "event" TEXT NOT NULL,
    "uuid" TEXT NOT NULL,
    "properties" JSONB NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deliveredAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AnalyticsOutbox_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AnalyticsOutbox_key_key" ON "AnalyticsOutbox"("key");
CREATE INDEX "AnalyticsOutbox_deliveredAt_nextAttemptAt_idx" ON "AnalyticsOutbox"("deliveredAt", "nextAttemptAt");
