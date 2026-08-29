-- CreateEnum
CREATE TYPE "EventType" AS ENUM ('TeamEvent', 'UserEvent');

-- AlterTable
ALTER TABLE "Team" ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- CreateTable
CREATE TABLE "User_Activity" (
    "id" SERIAL NOT NULL,
    "totalTeamsOwned" INTEGER NOT NULL,
    "userId" INTEGER NOT NULL,
    "lastActiveAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "activityStatus" TEXT NOT NULL DEFAULT 'inactive',
    "metadata" JSONB,

    CONSTRAINT "User_Activity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Team_Activity" (
    "id" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "total_tasks" INTEGER NOT NULL DEFAULT 0,
    "lastActiviyAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "activityStatus" TEXT NOT NULL DEFAULT 'inactive',
    "metadata" JSONB,

    CONSTRAINT "Team_Activity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Events" (
    "id" TEXT NOT NULL,
    "team_activity_id" TEXT,
    "eventType" "EventType" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "metadata" JSONB,

    CONSTRAINT "Events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_Activity_userId_key" ON "User_Activity"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Team_Activity_teamId_key" ON "Team_Activity"("teamId");

-- AddForeignKey
ALTER TABLE "User_Activity" ADD CONSTRAINT "User_Activity_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Team_Activity" ADD CONSTRAINT "Team_Activity_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Events" ADD CONSTRAINT "Events_team_activity_id_fkey" FOREIGN KEY ("team_activity_id") REFERENCES "Team_Activity"("id") ON DELETE SET NULL ON UPDATE CASCADE;
