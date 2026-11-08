BEGIN;

CREATE TABLE "GithubAppCredential" (
    "id" TEXT NOT NULL,
    "appId" VARCHAR(32) NOT NULL,
    "slug" VARCHAR(100) NOT NULL,
    "clientId" VARCHAR(256) NOT NULL,
    "ownerLogin" VARCHAR(100) NOT NULL,
    "htmlUrl" VARCHAR(256) NOT NULL,
    "clientSecret" TEXT NOT NULL,
    "privateKey" TEXT NOT NULL,
    "webhookSecret" TEXT NOT NULL,
    "stateSecret" TEXT NOT NULL,
    "createdByUserId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),
    CONSTRAINT "GithubAppCredential_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "GithubAppCredential_appId_check" CHECK ("appId" ~ '^[1-9][0-9]*$')
);

CREATE INDEX "GithubAppCredential_revokedAt_idx" ON "GithubAppCredential"("revokedAt");
CREATE UNIQUE INDEX "GithubAppCredential_single_active_key" ON "GithubAppCredential"((true)) WHERE "revokedAt" IS NULL;

COMMIT;
