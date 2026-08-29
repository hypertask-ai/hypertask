-- HTPR-4530: durable, retried delivery for board-wide webhook subscriptions.
-- Additive and backward-compatible with the currently deployed application.
CREATE TABLE "BoardWebhookDelivery" (
    "id" TEXT NOT NULL,
    "subscriptionId" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "processingAt" TIMESTAMP(3),
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastAttemptAt" TIMESTAMP(3),
    "statusCode" INTEGER,
    "error" TEXT,
    "deliveredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "BoardWebhookDelivery_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "BoardWebhookDelivery_subscriptionId_createdAt_idx" ON "BoardWebhookDelivery"("subscriptionId", "createdAt");
CREATE INDEX "BoardWebhookDelivery_status_nextAttemptAt_idx" ON "BoardWebhookDelivery"("status", "nextAttemptAt");
CREATE INDEX "BoardWebhookDelivery_createdAt_idx" ON "BoardWebhookDelivery"("createdAt");

ALTER TABLE "BoardWebhookDelivery" ADD CONSTRAINT "BoardWebhookDelivery_subscriptionId_fkey"
    FOREIGN KEY ("subscriptionId") REFERENCES "WebhookSubscription"("id") ON DELETE CASCADE ON UPDATE CASCADE;
