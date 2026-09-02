-- HTPR-5939: agent replies in Agent Chat point back at the human message they
-- answer. The unique column is the idempotency key for the agent POST, so a
-- retried delivery cannot create a second reply for the same turn.
ALTER TABLE "ChatMessage" ADD COLUMN "replyToMessageId" TEXT;
CREATE UNIQUE INDEX "ChatMessage_replyToMessageId_key" ON "ChatMessage"("replyToMessageId");
