ALTER TABLE "Notification"
ADD COLUMN "directReply" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "agentReplyConsumedAt" TIMESTAMP(3),
ADD COLUMN "agentReplyCommentId" INTEGER;

-- Historical comments have no exact invocation correlation, so recent requests
-- stay pending. Expire only requests old enough to no longer be actionable.
UPDATE "Notification"
SET "agentReplyConsumedAt" = CURRENT_TIMESTAMP
WHERE "agentId" IS NOT NULL
  AND "type" = 'Mentioned'
  AND "agentReplyConsumedAt" IS NULL
  AND "createdAt" < CURRENT_TIMESTAMP - INTERVAL '30 days';

CREATE INDEX "Notification_agentId_taskId_type_agentReplyConsumedAt_idx"
ON "Notification"("agentId", "taskId", "type", "agentReplyConsumedAt");
