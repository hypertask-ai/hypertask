-- Workspace-wide subscriptions reuse the durable board webhook outbox. Exactly
-- one scope is allowed so a mismatched project/team pair cannot cross tenants.
ALTER TABLE "WebhookSubscription" ALTER COLUMN "projectId" DROP NOT NULL;
ALTER TABLE "WebhookSubscription" ADD COLUMN "teamId" TEXT;
ALTER TABLE "WebhookSubscription" ADD CONSTRAINT "WebhookSubscription_scope_check"
  CHECK (("projectId" IS NOT NULL)::integer + ("teamId" IS NOT NULL)::integer = 1);

CREATE INDEX "WebhookSubscription_teamId_active_idx"
  ON "WebhookSubscription"("teamId", "active");

ALTER TABLE "WebhookSubscription" ADD CONSTRAINT "WebhookSubscription_teamId_fkey"
  FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- payloadBody is the exact immutable byte string signed on every automatic
-- attempt. Existing rows fall back to their JSON payload when delivered.
ALTER TABLE "BoardWebhookDelivery" ADD COLUMN "payloadBody" TEXT;
ALTER TABLE "BoardWebhookDelivery" ADD COLUMN "payloadHash" VARCHAR(64);
ALTER TABLE "BoardWebhookDelivery" ADD COLUMN "sourceDeliveryId" TEXT;
ALTER TABLE "BoardWebhookDelivery" ADD COLUMN "manualRetryKey" TEXT;

CREATE UNIQUE INDEX "BoardWebhookDelivery_subscriptionId_sourceDeliveryId_manualRetryKey_key"
  ON "BoardWebhookDelivery"("subscriptionId", "sourceDeliveryId", "manualRetryKey");

CREATE TABLE "BoardWebhookAttempt" (
  "id" TEXT NOT NULL,
  "deliveryId" TEXT NOT NULL,
  "attemptNumber" INTEGER NOT NULL,
  "statusCode" INTEGER,
  "durationMs" INTEGER NOT NULL,
  "error" TEXT,
  "attemptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "BoardWebhookAttempt_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "BoardWebhookAttempt_deliveryId_attemptNumber_key"
  ON "BoardWebhookAttempt"("deliveryId", "attemptNumber");
CREATE INDEX "BoardWebhookAttempt_attemptedAt_idx"
  ON "BoardWebhookAttempt"("attemptedAt");

ALTER TABLE "BoardWebhookAttempt" ADD CONSTRAINT "BoardWebhookAttempt_deliveryId_fkey"
  FOREIGN KEY ("deliveryId") REFERENCES "BoardWebhookDelivery"("id") ON DELETE CASCADE ON UPDATE CASCADE;
