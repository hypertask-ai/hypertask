-- AlterTable
ALTER TABLE "User" ALTER COLUMN "photoURL" SET DEFAULT 'https://duv2gcpdgd578.cloudfront.net/tasks/attachments/1757584422625image.png';

-- AlterTable
ALTER TABLE "UserSetting" ADD COLUMN     "productTours" JSONB NOT NULL DEFAULT '{}';
