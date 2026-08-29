-- DropForeignKey
ALTER TABLE "Attachment" DROP CONSTRAINT "Attachment_commentId_fkey";

-- AlterTable
ALTER TABLE "Attachment" ADD COLUMN     "descriptionId" TEXT,
ALTER COLUMN "commentId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "Task" ADD COLUMN     "descriptionId" TEXT;

-- CreateTable
CREATE TABLE "Description" (
    "id" TEXT NOT NULL,
    "content" TEXT NOT NULL DEFAULT '',
    "creatorId" INTEGER NOT NULL,
    "taskId" INTEGER NOT NULL,

    CONSTRAINT "Description_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Description_taskId_key" ON "Description"("taskId");

-- AddForeignKey
ALTER TABLE "Description" ADD CONSTRAINT "Description_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Description" ADD CONSTRAINT "Description_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_descriptionId_fkey" FOREIGN KEY ("descriptionId") REFERENCES "Description"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_commentId_fkey" FOREIGN KEY ("commentId") REFERENCES "Comment"("id") ON DELETE SET NULL ON UPDATE CASCADE;
