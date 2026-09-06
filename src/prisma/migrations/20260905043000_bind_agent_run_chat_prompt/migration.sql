-- No backfill: for a run that is still ACTIVE there is no record of which
-- prompt it was answering, and guessing binds it to the follow-up the user
-- sent because it was stuck. A null binding is handled: the sweep stops the
-- run and Stop ends it.
ALTER TABLE "AgentRun" ADD COLUMN "chatPromptMessageId" TEXT;
