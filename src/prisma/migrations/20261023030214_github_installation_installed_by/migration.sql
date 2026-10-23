ALTER TABLE "GithubInstallation" ADD COLUMN "installedByUserId" INTEGER;

CREATE INDEX "GithubInstallation_installedByUserId_idx" ON "GithubInstallation"("installedByUserId");
