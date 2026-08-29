ALTER TABLE "Notification" ADD COLUMN "tutorialKey" TEXT;

CREATE UNIQUE INDEX "Notification_tutorialKey_key" ON "Notification"("tutorialKey");
