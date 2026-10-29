-- HTPR-7905: optional receiver auth header per agent webhook. Additive; the value is stored sealed.
ALTER TABLE "AgentWebhookSubscription" ADD COLUMN "authHeaderName" TEXT;
ALTER TABLE "AgentWebhookSubscription" ADD COLUMN "authHeaderValue" TEXT;
