ALTER TABLE "TeamByokApiKey" ADD COLUMN "alwaysUse" BOOLEAN NOT NULL DEFAULT false;

CREATE UNIQUE INDEX "TeamByokApiKey_one_always_use_per_team" ON "TeamByokApiKey" ("teamId") WHERE "alwaysUse";
