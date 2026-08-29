/*
  Warnings:

  - You are about to drop the column `subscriptionPlanId` on the `Team` table. All the data in the column will be lost.

*/
-- DropIndex
DROP INDEX "SubscriptionPlan_teamId_key";

-- AlterTable
ALTER TABLE "Team" DROP COLUMN "subscriptionPlanId",
ADD COLUMN     "activeSubscriptionPlanId" TEXT;
