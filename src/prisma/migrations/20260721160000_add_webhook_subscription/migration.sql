-- HTPR-4434: outbound webhook subscriptions (signed delivery).
-- New table + FKs only. Touches no existing table's data.
CREATE TABLE "WebhookSubscription" (
    "id" TEXT NOT NULL,
    "projectId" INTEGER NOT NULL,
    "url" TEXT NOT NULL,
    "secret" TEXT NOT NULL,
    "events" TEXT[],
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdById" INTEGER,
    "agentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastDeliveryAt" TIMESTAMP(3),
    "lastDeliveryOk" BOOLEAN,
    CONSTRAINT "WebhookSubscription_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "WebhookSubscription_projectId_active_idx" ON "WebhookSubscription"("projectId", "active");

ALTER TABLE "WebhookSubscription" ADD CONSTRAINT "WebhookSubscription_projectId_fkey"
    FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WebhookSubscription" ADD CONSTRAINT "WebhookSubscription_createdById_fkey"
    FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "WebhookSubscription" ADD CONSTRAINT "WebhookSubscription_agentId_fkey"
    FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE SET NULL ON UPDATE CASCADE;
