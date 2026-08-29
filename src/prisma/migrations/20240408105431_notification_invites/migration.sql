-- DropForeignKey
ALTER TABLE "Notification" DROP CONSTRAINT "Notification_taskId_fkey";

-- AlterTable
ALTER TABLE "Notification" ADD COLUMN     "notification_inviteId" INTEGER,
ALTER COLUMN "taskId" DROP NOT NULL;

-- CreateTable
CREATE TABLE "User_Notification_Invites" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,

    CONSTRAINT "User_Notification_Invites_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification_Invite" (
    "id" SERIAL NOT NULL,
    "inviteURL" TEXT NOT NULL,
    "notificationId" INTEGER NOT NULL,
    "inviteId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userIdTo" INTEGER NOT NULL,
    "userIdBy" INTEGER NOT NULL,

    CONSTRAINT "Notification_Invite_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Notification_Invite_notificationId_key" ON "Notification_Invite"("notificationId");

-- CreateIndex
CREATE UNIQUE INDEX "Notification_Invite_userIdTo_key" ON "Notification_Invite"("userIdTo");

-- CreateIndex
CREATE UNIQUE INDEX "Notification_Invite_userIdBy_key" ON "Notification_Invite"("userIdBy");

-- AddForeignKey
ALTER TABLE "User_Notification_Invites" ADD CONSTRAINT "User_Notification_Invites_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification_Invite" ADD CONSTRAINT "Notification_Invite_inviteId_fkey" FOREIGN KEY ("inviteId") REFERENCES "Invite"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification_Invite" ADD CONSTRAINT "Notification_Invite_userIdTo_fkey" FOREIGN KEY ("userIdTo") REFERENCES "User_Notification_Invites"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification_Invite" ADD CONSTRAINT "Notification_Invite_userIdBy_fkey" FOREIGN KEY ("userIdBy") REFERENCES "User_Notification_Invites"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_notification_inviteId_fkey" FOREIGN KEY ("notification_inviteId") REFERENCES "Notification_Invite"("id") ON DELETE SET NULL ON UPDATE CASCADE;
