ALTER TYPE "AgentRunTrigger" ADD VALUE IF NOT EXISTS 'RUNTIME';

ALTER TABLE "AgentRun"
    ADD COLUMN "title" VARCHAR(250),
    DROP CONSTRAINT "AgentRun_context_check",
    ADD CONSTRAINT "AgentRun_context_check" CHECK (
        num_nonnulls("taskId", "chatSessionId") = 1
        AND (
            ("trigger"::text = 'CHAT' AND "chatSessionId" IS NOT NULL)
            OR ("trigger"::text IN ('MENTION', 'ASSIGNED', 'RUNTIME') AND "taskId" IS NOT NULL)
        )
    );
