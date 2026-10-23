BEGIN;

CREATE TYPE "GithubRepositoryProvenance" AS ENUM ('legacy', 'installed');
CREATE TYPE "GithubPullRequestLinkOrigin" AS ENUM ('installed');

CREATE TABLE "GithubInstallation" (
    "id" VARCHAR(32) NOT NULL,
    "accountId" VARCHAR(32) NOT NULL,
    "accountLogin" VARCHAR(100) NOT NULL,
    "accountType" VARCHAR(32) NOT NULL,
    "teamId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "GithubInstallation_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "GithubInstallation_id_check" CHECK ("id" ~ '^[1-9][0-9]*$'),
    CONSTRAINT "GithubInstallation_accountId_check" CHECK ("accountId" ~ '^[1-9][0-9]*$'),
    CONSTRAINT "GithubInstallation_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "BoardGithubRepository" (
    "id" TEXT NOT NULL,
    "projectId" INTEGER NOT NULL,
    "repositoryId" VARCHAR(32),
    "fullName" VARCHAR(201) NOT NULL,
    "installationId" VARCHAR(32),
    "provenance" "GithubRepositoryProvenance" NOT NULL,
    "activatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "BoardGithubRepository_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "BoardGithubRepository_repositoryId_check" CHECK ("repositoryId" IS NULL OR "repositoryId" ~ '^[1-9][0-9]*$'),
    CONSTRAINT "BoardGithubRepository_fullName_check" CHECK ("fullName" = lower("fullName") AND "fullName" ~ '^[a-z0-9_.-]+/[a-z0-9_.-]+$'),
    CONSTRAINT "BoardGithubRepository_installed_identity_check" CHECK ("provenance" <> 'installed' OR ("repositoryId" IS NOT NULL AND "installationId" IS NOT NULL)),
    CONSTRAINT "BoardGithubRepository_legacy_project_check" CHECK ("provenance" <> 'legacy' OR "projectId" = 15),
    CONSTRAINT "BoardGithubRepository_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "BoardGithubRepository_installationId_fkey" FOREIGN KEY ("installationId") REFERENCES "GithubInstallation"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "GithubWebhookDelivery" (
    "deliveryId" VARCHAR(100) NOT NULL,
    "businessEventKey" VARCHAR(255) NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),

    CONSTRAINT "GithubWebhookDelivery_pkey" PRIMARY KEY ("deliveryId")
);

ALTER TABLE "TaskPullRequest" ADD COLUMN "githubLinkOrigin" "GithubPullRequestLinkOrigin";

CREATE INDEX "GithubInstallation_teamId_idx" ON "GithubInstallation"("teamId");
CREATE INDEX "BoardGithubRepository_projectId_revokedAt_idx" ON "BoardGithubRepository"("projectId", "revokedAt");
CREATE INDEX "BoardGithubRepository_installationId_idx" ON "BoardGithubRepository"("installationId");
CREATE UNIQUE INDEX "BoardGithubRepository_active_repositoryId_key" ON "BoardGithubRepository"("repositoryId") WHERE "revokedAt" IS NULL AND "repositoryId" IS NOT NULL;
CREATE UNIQUE INDEX "BoardGithubRepository_active_fullName_key" ON "BoardGithubRepository"("fullName") WHERE "revokedAt" IS NULL;
CREATE UNIQUE INDEX "GithubWebhookDelivery_businessEventKey_key" ON "GithubWebhookDelivery"("businessEventKey");

INSERT INTO "BoardGithubRepository" ("id", "projectId", "fullName", "provenance")
SELECT 'htpr-7515-legacy-15-' || split_part(repository."fullName", '/', 2), project."id", repository."fullName", 'legacy'::"GithubRepositoryProvenance"
FROM "Project" AS project
CROSS JOIN (VALUES
    ('hypertask-ai/android'),
    ('hypertask-ai/app-releases'),
    ('hypertask-ai/cli'),
    ('hypertask-ai/docs'),
    ('hypertask-ai/hypertask'),
    ('hypertask-ai/skills')
) AS repository("fullName")
WHERE project."id" = 15
ON CONFLICT DO NOTHING;

COMMIT;
