-- HTPR-4370: team-scoped Slack installs and watched thread checkpoints.
CREATE TABLE "SlackInstall" (
    "id" TEXT NOT NULL,
    "slackTeamId" TEXT NOT NULL,
    "slackTeamName" TEXT NOT NULL,
    "encryptedBotToken" TEXT NOT NULL,
    "botUserId" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "defaultProjectId" INTEGER,
    "installedByUserId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SlackInstall_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SlackEventReceipt" (
    "eventId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SlackEventReceipt_pkey" PRIMARY KEY ("eventId")
);

CREATE TABLE "SlackWatchedThread" (
    "id" TEXT NOT NULL,
    "installId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "threadTs" TEXT NOT NULL,
    "matchedTaskIds" INTEGER[] NOT NULL DEFAULT ARRAY[]::INTEGER[],
    "lastMessageTs" TEXT NOT NULL,
    "lastSummarizedTs" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SlackWatchedThread_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SlackInstall_slackTeamId_key" ON "SlackInstall"("slackTeamId");
CREATE UNIQUE INDEX "SlackInstall_teamId_key" ON "SlackInstall"("teamId");
CREATE INDEX "SlackInstall_installedByUserId_idx" ON "SlackInstall"("installedByUserId");
CREATE INDEX "SlackInstall_defaultProjectId_idx" ON "SlackInstall"("defaultProjectId");
CREATE UNIQUE INDEX "SlackWatchedThread_installId_channelId_threadTs_key"
    ON "SlackWatchedThread"("installId", "channelId", "threadTs");
CREATE INDEX "SlackWatchedThread_lastMessageTs_idx" ON "SlackWatchedThread"("lastMessageTs");

ALTER TABLE "SlackInstall" ADD CONSTRAINT "SlackInstall_teamId_fkey"
    FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SlackInstall" ADD CONSTRAINT "SlackInstall_installedByUserId_fkey"
    FOREIGN KEY ("installedByUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SlackInstall" ADD CONSTRAINT "SlackInstall_defaultProjectId_fkey"
    FOREIGN KEY ("defaultProjectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SlackWatchedThread" ADD CONSTRAINT "SlackWatchedThread_installId_fkey"
    FOREIGN KEY ("installId") REFERENCES "SlackInstall"("id") ON DELETE CASCADE ON UPDATE CASCADE;
