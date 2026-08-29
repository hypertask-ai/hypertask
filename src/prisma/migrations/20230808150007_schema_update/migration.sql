/*
  Warnings:

  - You are about to drop the column `section` on the `Project` table. All the data in the column will be lost.
  - You are about to drop the column `tasks` on the `Section` table. All the data in the column will be lost.
  - You are about to drop the column `title` on the `Section` table. All the data in the column will be lost.
  - You are about to drop the column `orderIndex` on the `Task` table. All the data in the column will be lost.
  - Added the required column `section_title` to the `Section` table without a default value. This is not possible if the table is not empty.
  - Changed the type of `section` on the `Task` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.

*/
-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('Assigned', 'Comment', 'Invited');

-- CreateEnum
CREATE TYPE "InviteStatus" AS ENUM ('Invited', 'Accepted');

-- AlterTable
ALTER TABLE "Assignees" ADD COLUMN     "assignerId" INTEGER;

-- AlterTable
ALTER TABLE "Project" DROP COLUMN "section",
ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "sections" TEXT[] DEFAULT ARRAY['Todo', 'Doing', 'Done']::TEXT[],
ADD COLUMN     "title" TEXT;

-- AlterTable
ALTER TABLE "Section" DROP COLUMN "tasks",
DROP COLUMN "title",
ADD COLUMN     "deleted" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "ranking" TEXT NOT NULL DEFAULT 'A200',
ADD COLUMN     "section_title" VARCHAR(255) NOT NULL,
ADD COLUMN     "visibility" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "Task" DROP COLUMN "orderIndex",
ADD COLUMN     "archivedAt" TIMESTAMP(3),
ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "ranking" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "sectionId" INTEGER,
DROP COLUMN "section",
ADD COLUMN     "section" TEXT NOT NULL;

-- DropEnum
DROP TYPE "List";

-- CreateTable
CREATE TABLE "Member" (
    "id" SERIAL NOT NULL,
    "projectId" INTEGER NOT NULL,
    "userId" INTEGER NOT NULL,
    "status" "InviteStatus" NOT NULL DEFAULT 'Accepted',
    "invitedAt" TIMESTAMP(3),
    "acceptedAt" TIMESTAMP(3),

    CONSTRAINT "Member_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" SERIAL NOT NULL,
    "type" "NotificationType" NOT NULL DEFAULT 'Comment',
    "userId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "seen" BOOLEAN NOT NULL DEFAULT false,
    "status" "Status" NOT NULL DEFAULT 'Normal',
    "commentId" INTEGER,
    "assignId" INTEGER,
    "memberId" INTEGER,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "Member" ADD CONSTRAINT "Member_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Member" ADD CONSTRAINT "Member_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Assignees" ADD CONSTRAINT "Assignees_assignerId_fkey" FOREIGN KEY ("assignerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_commentId_fkey" FOREIGN KEY ("commentId") REFERENCES "Comment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_assignId_fkey" FOREIGN KEY ("assignId") REFERENCES "Assignees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE SET NULL ON UPDATE CASCADE;
