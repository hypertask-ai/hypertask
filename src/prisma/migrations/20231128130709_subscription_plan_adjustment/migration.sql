-- AlterTable
ALTER TABLE "SubscriptionPlan" ADD COLUMN     "subscriptionObject" JSONB,
ALTER COLUMN "interval" SET DATA TYPE TEXT;
