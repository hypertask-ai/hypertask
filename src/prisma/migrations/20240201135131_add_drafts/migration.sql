-- CreateEnum
CREATE TYPE "DraftType" AS ENUM ('Description', 'Comment');

-- CreateTable
CREATE TABLE "Drafts" (
    "id" SERIAL NOT NULL,
    "taskId" INTEGER NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "projectId" INTEGER NOT NULL,
    "content" TEXT NOT NULL DEFAULT '',
    "saved" BOOLEAN NOT NULL,
    "type" "DraftType" NOT NULL,

    CONSTRAINT "Drafts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Drafts_taskId_type_key" ON "Drafts"("taskId", "type");

-- AddForeignKey
ALTER TABLE "Drafts" ADD CONSTRAINT "Drafts_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
