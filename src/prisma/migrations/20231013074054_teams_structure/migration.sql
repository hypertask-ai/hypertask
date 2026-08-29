/*
  Warnings:

  - Added the required column `notificationId` to the `ReadStatus` table without a default value. This is not possible if the table is not empty.
  - Added the required column `readStatusId` to the `ReadStatus` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "SubscriptionPlanStatus" AS ENUM ('Free', 'AwaitingPayment', 'Paid');

-- AlterTable
ALTER TABLE "Invite" ADD COLUMN     "teamId" TEXT;

-- AlterTable
ALTER TABLE "Notification" ADD COLUMN     "member_team_Id" INTEGER;

-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "googleAccountId" TEXT,
ADD COLUMN     "teamId" TEXT;

-- AlterTable
ALTER TABLE "ReadStatus" ADD COLUMN     "notificationId" INTEGER NOT NULL,
ADD COLUMN     "readStatusId" INTEGER NOT NULL;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "accountId" TEXT,
ADD COLUMN     "stripe_customer_id" TEXT;

-- CreateTable
CREATE TABLE "GoogleAccount" (
    "id" TEXT NOT NULL,
    "userId" INTEGER NOT NULL,
    "stripe_customer_id" TEXT NOT NULL,

    CONSTRAINT "GoogleAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Team" (
    "id" TEXT NOT NULL,
    "totalSeats" INTEGER NOT NULL,
    "subscriptionPlanId" TEXT NOT NULL,
    "googleAccountId" TEXT NOT NULL,

    CONSTRAINT "Team_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SubscriptionPlan" (
    "id" TEXT NOT NULL,
    "subscriptionStatus" "SubscriptionPlanStatus" NOT NULL DEFAULT 'Free',
    "ownerId" TEXT NOT NULL,
    "projectIds" INTEGER[],
    "teamId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "priceId" TEXT NOT NULL,
    "subscriptionItemId" TEXT NOT NULL,
    "subscriptionId" TEXT NOT NULL,
    "totalSeats" INTEGER NOT NULL,
    "interval" INTEGER NOT NULL,
    "subscriptionStaretdAt" TIMESTAMP(3) NOT NULL,
    "subscriptionEndsAt" TIMESTAMP(3) NOT NULL,
    "nextIntervalAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SubscriptionPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Member_Team" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "status" "InviteStatus" NOT NULL DEFAULT 'Accepted',
    "invitedAt" TIMESTAMP(3),
    "acceptedAt" TIMESTAMP(3),
    "teamId" TEXT NOT NULL,
    "googleAccountId" TEXT NOT NULL,

    CONSTRAINT "Member_Team_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SubscriptionPlan_teamId_key" ON "SubscriptionPlan"("teamId");

-- AddForeignKey
ALTER TABLE "Team" ADD CONSTRAINT "Team_googleAccountId_fkey" FOREIGN KEY ("googleAccountId") REFERENCES "GoogleAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubscriptionPlan" ADD CONSTRAINT "SubscriptionPlan_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "GoogleAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubscriptionPlan" ADD CONSTRAINT "SubscriptionPlan_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invite" ADD CONSTRAINT "Invite_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_googleAccountId_fkey" FOREIGN KEY ("googleAccountId") REFERENCES "GoogleAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Member_Team" ADD CONSTRAINT "Member_Team_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Member_Team" ADD CONSTRAINT "Member_Team_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Member_Team" ADD CONSTRAINT "Member_Team_googleAccountId_fkey" FOREIGN KEY ("googleAccountId") REFERENCES "GoogleAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReadStatus" ADD CONSTRAINT "ReadStatus_notificationId_fkey" FOREIGN KEY ("notificationId") REFERENCES "Notification"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_member_team_Id_fkey" FOREIGN KEY ("member_team_Id") REFERENCES "Member_Team"("id") ON DELETE SET NULL ON UPDATE CASCADE;
