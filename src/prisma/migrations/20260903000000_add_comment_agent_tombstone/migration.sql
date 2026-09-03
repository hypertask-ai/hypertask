-- Preserve the display name of a managed agent on comments after hard deletion.
ALTER TABLE "Comment" ADD COLUMN "agentDisplayName" TEXT;
