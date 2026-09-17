-- HTPR-6557: one durable transcript and delivery queue per board.

CREATE TABLE "AgentRoom" (
    "id" TEXT NOT NULL,
    "projectId" INTEGER NOT NULL,
    "dailyTurnBudget" INTEGER NOT NULL DEFAULT 50,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgentRoom_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "AgentRoom_dailyTurnBudget_check" CHECK ("dailyTurnBudget" > 0)
);

CREATE TABLE "AgentRoomMessage" (
    "id" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "role" "ChatRole" NOT NULL,
    "exchangeId" TEXT NOT NULL,
    "botTurnDepth" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "stoppedAt" TIMESTAMP(3),
    "replyToMessageId" TEXT,
    "authorUserId" INTEGER,
    "authorAgentId" TEXT,
    "taskId" INTEGER,

    CONSTRAINT "AgentRoomMessage_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "AgentRoomMessage_botTurnDepth_check" CHECK ("botTurnDepth" BETWEEN 0 AND 3),
    CONSTRAINT "AgentRoomMessage_author_check" CHECK (
      ("role" = 'human' AND "authorAgentId" IS NULL)
      OR ("role" = 'assistant' AND "authorUserId" IS NULL)
    )
);

CREATE TABLE "AgentRoomDelivery" (
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "handledAt" TIMESTAMP(3),

    CONSTRAINT "AgentRoomDelivery_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AgentRoom_projectId_key" ON "AgentRoom"("projectId");
CREATE INDEX "AgentRoom_updatedAt_idx" ON "AgentRoom"("updatedAt");
CREATE UNIQUE INDEX "AgentRoomMessage_replyToMessageId_authorAgentId_key" ON "AgentRoomMessage"("replyToMessageId", "authorAgentId");
CREATE INDEX "AgentRoomMessage_roomId_exchangeId_idx" ON "AgentRoomMessage"("roomId", "exchangeId");
CREATE INDEX "AgentRoomMessage_roomId_createdAt_id_idx" ON "AgentRoomMessage"("roomId", "createdAt", "id");
CREATE INDEX "AgentRoomMessage_authorUserId_idx" ON "AgentRoomMessage"("authorUserId");
CREATE INDEX "AgentRoomMessage_authorAgentId_idx" ON "AgentRoomMessage"("authorAgentId");
CREATE INDEX "AgentRoomMessage_taskId_idx" ON "AgentRoomMessage"("taskId");
CREATE UNIQUE INDEX "AgentRoomDelivery_messageId_agentId_key" ON "AgentRoomDelivery"("messageId", "agentId");
CREATE INDEX "AgentRoomDelivery_agentId_handledAt_createdAt_idx" ON "AgentRoomDelivery"("agentId", "handledAt", "createdAt");

ALTER TABLE "AgentRoom" ADD CONSTRAINT "AgentRoom_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AgentRoomMessage" ADD CONSTRAINT "AgentRoomMessage_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "AgentRoom"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AgentRoomMessage" ADD CONSTRAINT "AgentRoomMessage_replyToMessageId_fkey" FOREIGN KEY ("replyToMessageId") REFERENCES "AgentRoomMessage"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AgentRoomMessage" ADD CONSTRAINT "AgentRoomMessage_authorUserId_fkey" FOREIGN KEY ("authorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AgentRoomMessage" ADD CONSTRAINT "AgentRoomMessage_authorAgentId_fkey" FOREIGN KEY ("authorAgentId") REFERENCES "Agent"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AgentRoomMessage" ADD CONSTRAINT "AgentRoomMessage_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AgentRoomDelivery" ADD CONSTRAINT "AgentRoomDelivery_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "AgentRoomMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AgentRoomDelivery" ADD CONSTRAINT "AgentRoomDelivery_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
