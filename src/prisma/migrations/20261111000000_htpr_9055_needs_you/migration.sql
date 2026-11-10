ALTER TABLE "Notification"
  ADD COLUMN "needsYouScore" INTEGER,
  ADD COLUMN "needsYouReason" TEXT,
  ADD COLUMN "needsYouSource" TEXT,
  ADD COLUMN "needsYouCostUsd" DOUBLE PRECISION,
  ADD COLUMN "needsYouScoredAt" TIMESTAMP(3);

CREATE INDEX "Notification_needs_you_pending_idx" ON "Notification" ("userId", "id")
  WHERE "needsYouScoredAt" IS NULL AND "agentId" IS NULL AND "status" = 'Normal' AND "archivedAt" IS NULL;
