-- HTPR-6653: default existing comps to Pro; null remains valid when clearing a comp.
CREATE TYPE "TeamCompPlan" AS ENUM ('Pro', 'BYOK');

ALTER TABLE "Team" ADD COLUMN "compedPlan" "TeamCompPlan" DEFAULT 'Pro';
