-- AlterEnum
ALTER TYPE "LogType" ADD VALUE 'Error';

-- CreateTable
CREATE TABLE "Announcments" (
    "id" SERIAL NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "body" JSONB NOT NULL,

    CONSTRAINT "Announcments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserAnnouncement" (
    "id" TEXT NOT NULL,
    "userId" INTEGER NOT NULL,
    "announcementId" INTEGER NOT NULL,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserAnnouncement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "UserAnnouncement_userId_announcementId_key" ON "UserAnnouncement"("userId", "announcementId");

-- AddForeignKey
ALTER TABLE "UserAnnouncement" ADD CONSTRAINT "UserAnnouncement_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserAnnouncement" ADD CONSTRAINT "UserAnnouncement_announcementId_fkey" FOREIGN KEY ("announcementId") REFERENCES "Announcments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
