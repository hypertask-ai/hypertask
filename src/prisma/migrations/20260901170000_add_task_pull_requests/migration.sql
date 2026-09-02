CREATE TABLE "TaskPullRequest" (
    "id" TEXT NOT NULL,
    "taskId" INTEGER NOT NULL,
    "repositoryOwner" VARCHAR(100) NOT NULL,
    "repositoryName" VARCHAR(100) NOT NULL,
    "githubRepositoryId" VARCHAR(32),
    "githubPullRequestId" VARCHAR(32),
    "number" INTEGER NOT NULL,
    "url" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "lifecycle" VARCHAR(16) NOT NULL DEFAULT 'open',
    "checkState" VARCHAR(16) NOT NULL DEFAULT 'pending',
    "headSha" VARCHAR(64),
    "sourceUpdatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TaskPullRequest_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TaskPullRequestCheckSuite" (
    "id" TEXT NOT NULL,
    "pullRequestId" TEXT NOT NULL,
    "githubAppId" VARCHAR(32) NOT NULL,
    "appName" VARCHAR(255) NOT NULL,
    "headSha" VARCHAR(64) NOT NULL,
    "status" VARCHAR(32) NOT NULL,
    "conclusion" VARCHAR(32),
    "sourceUpdatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TaskPullRequestCheckSuite_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TaskPullRequest_task_repo_pr_key"
ON "TaskPullRequest"("taskId", "repositoryOwner", "repositoryName", "number");

CREATE UNIQUE INDEX "TaskPullRequest_repo_pr_key"
ON "TaskPullRequest"("repositoryOwner", "repositoryName", "number");

CREATE INDEX "TaskPullRequest_repositoryOwner_repositoryName_number_idx"
ON "TaskPullRequest"("repositoryOwner", "repositoryName", "number");

CREATE UNIQUE INDEX "TaskPullRequestCheckSuite_pullRequestId_githubAppId_key"
ON "TaskPullRequestCheckSuite"("pullRequestId", "githubAppId");

CREATE INDEX "TaskPullRequestCheckSuite_pullRequestId_headSha_idx"
ON "TaskPullRequestCheckSuite"("pullRequestId", "headSha");

ALTER TABLE "TaskPullRequest"
ADD CONSTRAINT "TaskPullRequest_taskId_fkey"
FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "TaskPullRequestCheckSuite"
ADD CONSTRAINT "TaskPullRequestCheckSuite_pullRequestId_fkey"
FOREIGN KEY ("pullRequestId") REFERENCES "TaskPullRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;
