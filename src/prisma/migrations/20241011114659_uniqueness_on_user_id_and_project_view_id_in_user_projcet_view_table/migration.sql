/*
  Warnings:

  - A unique constraint covering the columns `[userId,project_view_id]` on the table `User_Project_View` will be added. If there are existing duplicate values, this will fail.

*/
-- DropIndex
DROP INDEX "User_Project_View_userId_key";

-- CreateIndex
CREATE UNIQUE INDEX "User_Project_View_userId_project_view_id_key" ON "User_Project_View"("userId", "project_view_id");
