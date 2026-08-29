-- AlterTable
ALTER TABLE "Comment" ADD COLUMN     "commentText" TEXT NOT NULL DEFAULT '';

-- CreateTable
CREATE TABLE "Url" (
    "id" SERIAL NOT NULL,
    "urlString" TEXT NOT NULL,
    "commentId" INTEGER NOT NULL,
    "TaskId" INTEGER NOT NULL,

    CONSTRAINT "Url_pkey" PRIMARY KEY ("id")
);
