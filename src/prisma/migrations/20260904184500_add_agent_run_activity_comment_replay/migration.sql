ALTER TABLE "AgentRunActivity"
    ADD COLUMN "responseCommentId" INTEGER,
    ADD COLUMN "selectionCommentId" INTEGER,
    ADD COLUMN "commentAgentWebhookDeliveryIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    ADD COLUMN "commentBoardWebhookDeliveryIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    ADD COLUMN "commentNotificationsProcessingAt" TIMESTAMP(3),
    ADD COLUMN "commentNotificationsSentAt" TIMESTAMP(3),
    ADD CONSTRAINT "AgentRunActivity_response_comment_check" CHECK (
        "type" = 'RESPONSE' OR "responseCommentId" IS NULL
    ),
    ADD CONSTRAINT "AgentRunActivity_selection_comment_check" CHECK (
        "selectionCommentId" IS NULL OR ("type" = 'ELICITATION' AND "selectedAt" IS NOT NULL)
    );

CREATE UNIQUE INDEX "AgentRunActivity_responseCommentId_key"
    ON "AgentRunActivity"("responseCommentId");
CREATE UNIQUE INDEX "AgentRunActivity_selectionCommentId_key"
    ON "AgentRunActivity"("selectionCommentId");

ALTER TABLE "AgentRunActivity" ADD CONSTRAINT "AgentRunActivity_responseCommentId_fkey"
    FOREIGN KEY ("responseCommentId") REFERENCES "Comment"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AgentRunActivity" ADD CONSTRAINT "AgentRunActivity_selectionCommentId_fkey"
    FOREIGN KEY ("selectionCommentId") REFERENCES "Comment"("id") ON DELETE SET NULL ON UPDATE CASCADE;
