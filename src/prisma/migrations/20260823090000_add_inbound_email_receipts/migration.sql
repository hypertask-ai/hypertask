CREATE TABLE "InboundEmailReceipt" (
    "emailId" VARCHAR(128) NOT NULL,
    "taskId" INTEGER NOT NULL,
    "commentId" INTEGER,
    "processingStartedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InboundEmailReceipt_pkey" PRIMARY KEY ("emailId")
);

CREATE UNIQUE INDEX "InboundEmailReceipt_commentId_key" ON "InboundEmailReceipt"("commentId");

ALTER TABLE "InboundEmailReceipt"
ADD CONSTRAINT "InboundEmailReceipt_commentId_fkey"
FOREIGN KEY ("commentId") REFERENCES "Comment"("id") ON DELETE SET NULL ON UPDATE CASCADE;
