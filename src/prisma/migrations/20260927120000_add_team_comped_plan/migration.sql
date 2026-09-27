-- HTPR-6653: which plan a comp grants. Null keeps every existing comp on Pro.
CREATE TYPE "TeamCompPlan" AS ENUM ('Pro', 'BYOK');

ALTER TABLE "Team" ADD COLUMN "compedPlan" "TeamCompPlan";
