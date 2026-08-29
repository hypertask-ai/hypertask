-- AlterTable
ALTER TABLE "Project_View" ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "User_Project_View" ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "View" ADD COLUMN     "board_columns_view" JSONB,
ADD COLUMN     "board_filters" JSONB,
ADD COLUMN     "board_sorting_mode" "SortingMode" NOT NULL DEFAULT 'Manual',
ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
