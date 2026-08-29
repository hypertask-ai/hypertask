-- HTPR-5388: addressed, durable outbound webhooks for managed agents.
-- Additive and backward-compatible with the currently deployed application.
CREATE TABLE "AgentWebhookSubscription" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "projectId" INTEGER,
    "url" TEXT NOT NULL,
    "secret" TEXT NOT NULL,
    "events" TEXT[] NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "lastDeliveryAt" TIMESTAMP(3),
    "lastDeliveryOk" BOOLEAN,
    CONSTRAINT "AgentWebhookSubscription_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AgentWebhookDelivery" (
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
    "responseBody" TEXT,
    "error" TEXT,
    "deliveredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AgentWebhookDelivery_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AgentWebhookSubscription_agentId_key" ON "AgentWebhookSubscription"("agentId");
CREATE INDEX "AgentWebhookSubscription_projectId_active_idx" ON "AgentWebhookSubscription"("projectId", "active");
CREATE INDEX "AgentWebhookDelivery_subscriptionId_createdAt_idx" ON "AgentWebhookDelivery"("subscriptionId", "createdAt");
CREATE INDEX "AgentWebhookDelivery_status_nextAttemptAt_idx" ON "AgentWebhookDelivery"("status", "nextAttemptAt");
CREATE INDEX "AgentWebhookDelivery_createdAt_idx" ON "AgentWebhookDelivery"("createdAt");

ALTER TABLE "AgentWebhookSubscription" ADD CONSTRAINT "AgentWebhookSubscription_agentId_fkey"
    FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AgentWebhookSubscription" ADD CONSTRAINT "AgentWebhookSubscription_projectId_fkey"
    FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AgentWebhookDelivery" ADD CONSTRAINT "AgentWebhookDelivery_subscriptionId_fkey"
    FOREIGN KEY ("subscriptionId") REFERENCES "AgentWebhookSubscription"("id") ON DELETE CASCADE ON UPDATE CASCADE;
