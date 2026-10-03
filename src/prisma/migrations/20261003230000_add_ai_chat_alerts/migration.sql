CREATE TABLE "AiChatAlertSample" (
    "id" BIGSERIAL PRIMARY KEY,
    "environment" TEXT NOT NULL CHECK ("environment" IN ('production', 'preview')),
    "happenedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "latencyMs" INTEGER NOT NULL CHECK ("latencyMs" >= 0),
    "statusCode" INTEGER NOT NULL CHECK ("statusCode" IN (0, 200, 500))
);
CREATE INDEX "AiChatAlertSample_environment_happenedAt_idx" ON "AiChatAlertSample"("environment", "happenedAt");

CREATE TABLE "AiChatAlertIncident" (
    "id" TEXT PRIMARY KEY,
    "environment" TEXT NOT NULL CHECK ("environment" IN ('production', 'preview')),
    "kind" TEXT NOT NULL CHECK ("kind" IN ('error_rate', 'latency')),
    "openedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "healthySince" TIMESTAMPTZ(3),
    "closedAt" TIMESTAMPTZ(3)
);
CREATE UNIQUE INDEX "AiChatAlertIncident_open_kind_key" ON "AiChatAlertIncident"("environment", "kind") WHERE "closedAt" IS NULL;
CREATE INDEX "AiChatAlertIncident_environment_closedAt_idx" ON "AiChatAlertIncident"("environment", "closedAt");

CREATE TABLE "AiChatAlertDelivery" (
    "id" TEXT PRIMARY KEY,
    "incidentId" TEXT NOT NULL REFERENCES "AiChatAlertIncident"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    "phase" TEXT NOT NULL CHECK ("phase" IN ('breach', 'recovery')),
    "requestCount" INTEGER NOT NULL CHECK ("requestCount" >= 0),
    "errorCount" INTEGER NOT NULL CHECK ("errorCount" >= 0 AND "errorCount" <= "requestCount"),
    "p95Ms" INTEGER NOT NULL CHECK ("p95Ms" >= 0),
    "happenedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" TEXT NOT NULL DEFAULT 'pending' CHECK ("status" IN ('pending', 'delivered', 'failed')),
    "attemptCount" INTEGER NOT NULL DEFAULT 0 CHECK ("attemptCount" BETWEEN 0 AND 4),
    "nextAttemptAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "AiChatAlertDelivery_incidentId_phase_key" ON "AiChatAlertDelivery"("incidentId", "phase");
CREATE INDEX "AiChatAlertDelivery_status_nextAttemptAt_idx" ON "AiChatAlertDelivery"("status", "nextAttemptAt");
