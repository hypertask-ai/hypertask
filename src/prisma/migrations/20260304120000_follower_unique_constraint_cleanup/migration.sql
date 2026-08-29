-- HTPR-3641: Fix task owner in followers + duplicate followers
-- 1. Remove duplicate followers (keep one per userId+taskId, keep lowest id)
-- 2. Remove followers who are task owners (owner should never be in followers)
-- 3. Add unique constraint to prevent future duplicates

-- Step 1: Delete duplicate followers
DELETE FROM "Follower" a
USING "Follower" b
WHERE a.id > b.id AND a."userId" = b."userId" AND a."taskId" = b."taskId";

-- Step 2: Delete followers who are task owners
DELETE FROM "Follower" f
USING "Task" t
WHERE f."taskId" = t.id AND f."userId" = t."userId";

-- Step 3: Add unique constraint
ALTER TABLE "Follower" ADD CONSTRAINT "Follower_userId_taskId_key" UNIQUE ("userId", "taskId");
