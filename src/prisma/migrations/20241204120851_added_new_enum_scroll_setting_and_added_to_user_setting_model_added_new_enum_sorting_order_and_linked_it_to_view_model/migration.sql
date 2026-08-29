-- CreateEnum
CREATE TYPE "SortingOrder" AS ENUM ('Ascending', 'Descending');

-- CreateEnum
CREATE TYPE "ScrollSetting" AS ENUM ('None', 'Bottom', 'Inbox');

-- AlterTable
ALTER TABLE "UserSetting" ADD COLUMN     "scrollSetting" "ScrollSetting" NOT NULL DEFAULT 'Inbox';

-- AlterTable
ALTER TABLE "View" ADD COLUMN     "board_sorting_order" "SortingOrder" NOT NULL DEFAULT 'Descending';
