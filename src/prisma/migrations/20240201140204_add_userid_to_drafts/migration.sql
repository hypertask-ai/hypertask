/*
  Warnings:

  - A unique constraint covering the columns `[taskId,type,userId]` on the table `Drafts` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `userId` to the `Drafts` table without a default value. This is not possible if the table is not empty.

*/
-- DropIndex
DROP INDEX "Drafts_taskId_type_key";

-- AlterTable
ALTER TABLE "Drafts" ADD COLUMN     "userId" INTEGER NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "Drafts_taskId_type_userId_key" ON "Drafts"("taskId", "type", "userId");

-- AddForeignKey
ALTER TABLE "Drafts" ADD CONSTRAINT "Drafts_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
