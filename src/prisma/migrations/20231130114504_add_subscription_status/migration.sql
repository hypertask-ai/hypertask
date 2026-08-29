-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "SubscriptionPlanStatus" ADD VALUE 'active';
ALTER TYPE "SubscriptionPlanStatus" ADD VALUE 'past_due';
ALTER TYPE "SubscriptionPlanStatus" ADD VALUE 'unpaid';
ALTER TYPE "SubscriptionPlanStatus" ADD VALUE 'canceled';
ALTER TYPE "SubscriptionPlanStatus" ADD VALUE 'incomplete';
ALTER TYPE "SubscriptionPlanStatus" ADD VALUE 'incomplete_expired';
ALTER TYPE "SubscriptionPlanStatus" ADD VALUE 'trialing';
ALTER TYPE "SubscriptionPlanStatus" ADD VALUE 'paused';
ALTER TYPE "SubscriptionPlanStatus" ADD VALUE 'all';
ALTER TYPE "SubscriptionPlanStatus" ADD VALUE 'ended';
