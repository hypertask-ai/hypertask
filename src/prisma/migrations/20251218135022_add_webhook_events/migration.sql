-- CreateTable
CREATE TABLE "WebhookEvent" (
    "id" TEXT NOT NULL,
    "userId" INTEGER NOT NULL,
    "eventType" TEXT NOT NULL,
    "success" BOOLEAN NOT NULL DEFAULT false,
    "response" JSONB,
    "error" TEXT,
    "utmData" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WebhookEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WebhookEvent_userId_eventType_idx" ON "WebhookEvent"("userId", "eventType");

-- CreateIndex
CREATE INDEX "WebhookEvent_success_idx" ON "WebhookEvent"("success");

-- CreateIndex
CREATE UNIQUE INDEX "WebhookEvent_userId_eventType_key" ON "WebhookEvent"("userId", "eventType");

-- AddForeignKey
ALTER TABLE "WebhookEvent" ADD CONSTRAINT "WebhookEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
