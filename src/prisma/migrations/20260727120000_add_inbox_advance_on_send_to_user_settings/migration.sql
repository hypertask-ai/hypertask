-- Inbox behaviour: sending a comment archives the inbox notification and
-- advances to the next task. On by default (Superhuman-style triage).
ALTER TABLE "UserSetting" ADD COLUMN "inboxAdvanceOnSend" BOOLEAN NOT NULL DEFAULT true;
