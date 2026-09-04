CREATE TYPE "AgentRunActivityType" AS ENUM ('THOUGHT', 'ACTION', 'RESPONSE', 'ERROR', 'ELICITATION');

CREATE TABLE "AgentRunActivity" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "type" "AgentRunActivityType" NOT NULL,
    "text" TEXT NOT NULL,
    "link" VARCHAR(2048),
    "options" JSONB,
    "idempotencyKey" VARCHAR(256),
    "selectedValue" VARCHAR(256),
    "selectedLabel" VARCHAR(256),
    "selectedAt" TIMESTAMP(3),
    "selectedById" INTEGER,
    "responseCommentId" INTEGER,
    "selectionCommentId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentRunActivity_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "AgentRunActivity_link_type_check" CHECK (
        "type" = 'ACTION' OR "link" IS NULL
    ),
    CONSTRAINT "AgentRunActivity_options_type_check" CHECK (
        ("type" = 'ELICITATION' AND "options" IS NOT NULL)
        OR ("type" <> 'ELICITATION' AND "options" IS NULL)
    ),
    CONSTRAINT "AgentRunActivity_selection_check" CHECK (
        ("selectedAt" IS NULL AND "selectedValue" IS NULL AND "selectedLabel" IS NULL AND "selectedById" IS NULL)
        OR
        ("type" = 'ELICITATION' AND "selectedAt" IS NOT NULL AND "selectedValue" IS NOT NULL AND "selectedLabel" IS NOT NULL)
    ),
    CONSTRAINT "AgentRunActivity_response_comment_check" CHECK (
        "type" = 'RESPONSE' OR "responseCommentId" IS NULL
    ),
    CONSTRAINT "AgentRunActivity_selection_comment_check" CHECK (
        "selectionCommentId" IS NULL OR ("type" = 'ELICITATION' AND "selectedAt" IS NOT NULL)
    )
);

CREATE UNIQUE INDEX "AgentRunActivity_runId_idempotencyKey_key"
    ON "AgentRunActivity"("runId", "idempotencyKey");
CREATE INDEX "AgentRunActivity_runId_createdAt_id_idx"
    ON "AgentRunActivity"("runId", "createdAt", "id");
CREATE INDEX "AgentRunActivity_selectedById_idx"
    ON "AgentRunActivity"("selectedById");
CREATE UNIQUE INDEX "AgentRunActivity_responseCommentId_key"
    ON "AgentRunActivity"("responseCommentId");
CREATE UNIQUE INDEX "AgentRunActivity_selectionCommentId_key"
    ON "AgentRunActivity"("selectionCommentId");

ALTER TABLE "AgentRunActivity" ADD CONSTRAINT "AgentRunActivity_runId_fkey"
    FOREIGN KEY ("runId") REFERENCES "AgentRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AgentRunActivity" ADD CONSTRAINT "AgentRunActivity_selectedById_fkey"
    FOREIGN KEY ("selectedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AgentRunActivity" ADD CONSTRAINT "AgentRunActivity_responseCommentId_fkey"
    FOREIGN KEY ("responseCommentId") REFERENCES "Comment"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AgentRunActivity" ADD CONSTRAINT "AgentRunActivity_selectionCommentId_fkey"
    FOREIGN KEY ("selectionCommentId") REFERENCES "Comment"("id") ON DELETE SET NULL ON UPDATE CASCADE;
