ALTER TABLE "WebhookSubscription" ADD COLUMN "createdByAgentId" TEXT;
UPDATE "WebhookSubscription" SET "createdByAgentId" = "agentId" WHERE "agentId" IS NOT NULL;
