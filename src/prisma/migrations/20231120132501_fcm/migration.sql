-- CreateTable
CREATE TABLE "SubscribedDevices" (
    "id" TEXT NOT NULL,
    "firebaseId" TEXT NOT NULL DEFAULT '',
    "sendNotifications" BOOLEAN NOT NULL DEFAULT true,
    "userId" INTEGER NOT NULL,

    CONSTRAINT "SubscribedDevices_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "SubscribedDevices" ADD CONSTRAINT "SubscribedDevices_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
