CREATE TABLE "FeatureFlagReview" (
    "id" SERIAL NOT NULL,
    "key" TEXT NOT NULL,
    "mode" "FeatureFlagMode" NOT NULL,
    "reviewerUserId" INTEGER NOT NULL,
    "reviewerAgentId" TEXT NOT NULL,
    "aiReviewUrl" VARCHAR(300) NOT NULL,
    "independentReview" VARCHAR(300) NOT NULL,
    "liveQaUrl" VARCHAR(300) NOT NULL,
    "inboxCyclePassed" BOOLEAN NOT NULL,
    "deployedSha" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "usedAt" TIMESTAMP(3),
    "usedByChangeId" INTEGER,

    CONSTRAINT "FeatureFlagReview_pkey" PRIMARY KEY ("id")
);
