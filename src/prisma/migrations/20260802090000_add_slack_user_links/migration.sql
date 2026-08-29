-- HTPR-4826: map each Slack member to one Hypertask user per install.
CREATE TABLE "SlackUserLink" (
    "id" TEXT NOT NULL,
    "installId" TEXT NOT NULL,
    "slackUserId" TEXT NOT NULL,
    "userId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SlackUserLink_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SlackUserLink_installId_slackUserId_key"
    ON "SlackUserLink"("installId", "slackUserId");
CREATE UNIQUE INDEX "SlackUserLink_installId_userId_key"
    ON "SlackUserLink"("installId", "userId");
CREATE INDEX "SlackUserLink_userId_idx" ON "SlackUserLink"("userId");

ALTER TABLE "SlackUserLink" ADD CONSTRAINT "SlackUserLink_installId_fkey"
    FOREIGN KEY ("installId") REFERENCES "SlackInstall"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SlackUserLink" ADD CONSTRAINT "SlackUserLink_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
