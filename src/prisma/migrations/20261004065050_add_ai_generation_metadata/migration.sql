-- Context-free system calls must not be attributed to a fictional user.
ALTER TABLE "AiUsage" ALTER COLUMN "userId" DROP NOT NULL;

ALTER TABLE "AiUsage"
  ADD COLUMN "costUsd" DOUBLE PRECISION,
  ADD COLUMN "latencyMs" INTEGER,
  ADD COLUMN "promptId" TEXT,
  ADD COLUMN "promptVersion" TEXT,
  ADD COLUMN "outcome" TEXT,
  ADD COLUMN "traceId" TEXT;
