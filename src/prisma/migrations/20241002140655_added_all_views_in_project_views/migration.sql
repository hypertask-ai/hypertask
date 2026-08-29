/*
  Warnings:

  - Added the required column `project_view_id` to the `View` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "View" ADD COLUMN     "project_view_id" TEXT NOT NULL;

-- AddForeignKey
ALTER TABLE "View" ADD CONSTRAINT "View_project_view_id_fkey" FOREIGN KEY ("project_view_id") REFERENCES "Project_View"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
