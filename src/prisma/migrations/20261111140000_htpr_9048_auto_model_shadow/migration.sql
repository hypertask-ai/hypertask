CREATE TABLE "AutoModelShadow" (
    "id" BIGSERIAL NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userId" INTEGER NOT NULL,
    "teamId" TEXT,
    "projectId" INTEGER,
    "chatSessionId" TEXT,
    "feature" TEXT NOT NULL,
    "autoTier" INTEGER NOT NULL,
    "autoStepUp" INTEGER NOT NULL DEFAULT 0,
    "autoModelKey" TEXT,
    "jevLevel" TEXT,
    "jevTier" INTEGER,
    "jevConfidence" DOUBLE PRECISION,
    "jevLatencyMs" INTEGER NOT NULL,
    "longThread" BOOLEAN NOT NULL DEFAULT false,
    "resent" BOOLEAN NOT NULL DEFAULT false,
    "codeFence" BOOLEAN NOT NULL DEFAULT false,
    "comparison" TEXT,
    "error" TEXT,

    CONSTRAINT "AutoModelShadow_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AutoModelShadow_createdAt_idx" ON "AutoModelShadow"("createdAt");
CREATE INDEX "AutoModelShadow_chatSessionId_createdAt_idx" ON "AutoModelShadow"("chatSessionId", "createdAt");
