-- AlterTable
ALTER TABLE "User_Project_View" ADD COLUMN     "unsavedViewId" TEXT;

-- AddForeignKey
ALTER TABLE "User_Project_View" ADD CONSTRAINT "User_Project_View_unsavedViewId_fkey" FOREIGN KEY ("unsavedViewId") REFERENCES "View"("id") ON DELETE SET NULL ON UPDATE CASCADE;
