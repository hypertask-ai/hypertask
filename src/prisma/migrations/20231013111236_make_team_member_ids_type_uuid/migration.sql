/*
  Warnings:

  - The primary key for the `Member_Team` table will be changed. If it partially fails, the table could be left without primary key constraint.

*/
-- DropForeignKey
ALTER TABLE "Notification" DROP CONSTRAINT "Notification_member_team_Id_fkey";

-- AlterTable
ALTER TABLE "Member_Team" DROP CONSTRAINT "Member_Team_pkey",
ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "id" SET DATA TYPE TEXT,
ADD CONSTRAINT "Member_Team_pkey" PRIMARY KEY ("id");
DROP SEQUENCE "Member_Team_id_seq";

-- AlterTable
ALTER TABLE "Notification" ALTER COLUMN "member_team_Id" SET DATA TYPE TEXT;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_member_team_Id_fkey" FOREIGN KEY ("member_team_Id") REFERENCES "Member_Team"("id") ON DELETE SET NULL ON UPDATE CASCADE;
