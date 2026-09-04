CREATE TYPE "FeatureFlagMode" AS ENUM ('OFF', 'OWNER_ONLY', 'EVERYONE');

CREATE TABLE "FeatureFlag" (
    "key" TEXT NOT NULL,
    "mode" "FeatureFlagMode" NOT NULL DEFAULT 'OWNER_ONLY',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FeatureFlag_pkey" PRIMARY KEY ("key")
);

INSERT INTO "FeatureFlag" ("key", "mode", "updatedAt")
VALUES ('htpr-6091-feature-flags', 'OWNER_ONLY', CURRENT_TIMESTAMP);
