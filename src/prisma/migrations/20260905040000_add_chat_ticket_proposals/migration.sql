CREATE TYPE "ChatTicketProposalStatus" AS ENUM ('PENDING', 'FAILED', 'CONFIRMED', 'DISMISSED');

CREATE TABLE "ChatTicketProposal" (
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "snapshotVersion" INTEGER NOT NULL DEFAULT 1,
    "outcome" TEXT NOT NULL,
    "ticketTitle" VARCHAR(255) NOT NULL,
    "targetProjectId" INTEGER NOT NULL,
    "targetProjectTitle" VARCHAR(255) NOT NULL,
    "targetSectionId" INTEGER NOT NULL,
    "targetSectionTitle" VARCHAR(255) NOT NULL,
    "status" "ChatTicketProposalStatus" NOT NULL DEFAULT 'PENDING',
    "failureMessage" VARCHAR(255),
    "taskId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "failedAt" TIMESTAMP(3),
    "confirmedAt" TIMESTAMP(3),
    "dismissedAt" TIMESTAMP(3),

    CONSTRAINT "ChatTicketProposal_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ChatTicketProposal_messageId_key" ON "ChatTicketProposal"("messageId");
CREATE UNIQUE INDEX "ChatTicketProposal_taskId_key" ON "ChatTicketProposal"("taskId");
CREATE INDEX "ChatTicketProposal_targetProjectId_status_idx" ON "ChatTicketProposal"("targetProjectId", "status");

ALTER TABLE "ChatTicketProposal" ADD CONSTRAINT "ChatTicketProposal_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "ChatMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ChatTicketProposal" ADD CONSTRAINT "ChatTicketProposal_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE SET NULL ON UPDATE CASCADE;
