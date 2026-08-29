-- HTPR-4809: optional prompt used to keep smart-label membership current.
ALTER TABLE "Label" ADD COLUMN "ai_prompt" TEXT;
