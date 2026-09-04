ALTER TABLE "User" ADD COLUMN "canManageFeatureFlags" BOOLEAN NOT NULL DEFAULT false;
UPDATE "User"
SET "canManageFeatureFlags" = true
WHERE "id" = 6 AND LOWER("email") = 'valentin.yeo@gmail.com';
