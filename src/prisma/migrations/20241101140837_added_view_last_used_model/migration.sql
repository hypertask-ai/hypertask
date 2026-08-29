-- CreateTable
CREATE TABLE "View_Last_Used" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3),
    "userId" INTEGER NOT NULL,
    "viewId" TEXT NOT NULL,

    CONSTRAINT "View_Last_Used_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "View_Last_Used_userId_viewId_key" ON "View_Last_Used"("userId", "viewId");

-- AddForeignKey
ALTER TABLE "View_Last_Used" ADD CONSTRAINT "View_Last_Used_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "View_Last_Used" ADD CONSTRAINT "View_Last_Used_viewId_fkey" FOREIGN KEY ("viewId") REFERENCES "View"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
