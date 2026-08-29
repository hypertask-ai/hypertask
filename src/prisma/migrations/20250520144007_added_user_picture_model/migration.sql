-- CreateTable
CREATE TABLE "UserPicture" (
    "id" TEXT NOT NULL,
    "userId" INTEGER NOT NULL,
    "photoSet" BOOLEAN NOT NULL DEFAULT false,
    "basePhotoURL" TEXT,

    CONSTRAINT "UserPicture_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "UserPicture_userId_key" ON "UserPicture"("userId");

-- AddForeignKey
ALTER TABLE "UserPicture" ADD CONSTRAINT "UserPicture_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
