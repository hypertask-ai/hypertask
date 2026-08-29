-- CreateTable
CREATE TABLE "TeamByokApiKey" (
    "id" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "ciphertext" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TeamByokApiKey_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TeamByokApiKey_teamId_idx" ON "TeamByokApiKey"("teamId");

-- CreateIndex
CREATE UNIQUE INDEX "TeamByokApiKey_teamId_provider_key" ON "TeamByokApiKey"("teamId", "provider");

-- AddForeignKey
ALTER TABLE "TeamByokApiKey" ADD CONSTRAINT "TeamByokApiKey_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;
