-- CreateTable
CREATE TABLE "AiSettingOperation" (
    "id" TEXT NOT NULL,
    "userId" INTEGER NOT NULL,
    "proposalId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiSettingOperation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AiSettingOperation_proposalId_idx" ON "AiSettingOperation"("proposalId");
