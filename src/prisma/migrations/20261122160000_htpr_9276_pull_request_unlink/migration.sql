CREATE TABLE "TaskPullRequestUnlink" (
    "id" TEXT NOT NULL,
    "taskId" INTEGER NOT NULL,
    "repositoryOwner" VARCHAR(100) NOT NULL,
    "repositoryName" VARCHAR(100) NOT NULL,
    "number" INTEGER NOT NULL,
    "userId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TaskPullRequestUnlink_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TaskPullRequestUnlink_task_repo_pr_key"
ON "TaskPullRequestUnlink"("taskId", "repositoryOwner", "repositoryName", "number");

CREATE INDEX "TaskPullRequestUnlink_repositoryOwner_repositoryName_number_idx"
ON "TaskPullRequestUnlink"("repositoryOwner", "repositoryName", "number");

ALTER TABLE "TaskPullRequestUnlink"
ADD CONSTRAINT "TaskPullRequestUnlink_taskId_fkey"
FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;
