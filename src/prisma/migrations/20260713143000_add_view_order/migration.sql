-- AlterTable
ALTER TABLE "Project_View" ADD COLUMN "default_view_order" JSONB;

-- AlterTable
ALTER TABLE "User_Project_View" ADD COLUMN "view_order" JSONB;
