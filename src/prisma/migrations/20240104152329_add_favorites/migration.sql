-- CreateTable
CREATE TABLE "Favorites" (
    "id" TEXT NOT NULL,
    "userSettingId" TEXT NOT NULL,
    "projectId" INTEGER NOT NULL,
    "index" INTEGER NOT NULL,

    CONSTRAINT "Favorites_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Favorites_userSettingId_key" ON "Favorites"("userSettingId");

-- AddForeignKey
ALTER TABLE "Favorites" ADD CONSTRAINT "Favorites_userSettingId_fkey" FOREIGN KEY ("userSettingId") REFERENCES "UserSetting"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Favorites" ADD CONSTRAINT "Favorites_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
