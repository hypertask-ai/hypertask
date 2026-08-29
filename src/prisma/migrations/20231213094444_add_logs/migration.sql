-- CreateEnum
CREATE TYPE "LogType" AS ENUM ('Board', 'Task', 'Comment', 'Team', 'Invite', 'Signup');

-- CreateTable
CREATE TABLE "Logs" (
    "id" SERIAL NOT NULL,
    "log" TEXT NOT NULL,
    "type" "LogType" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "LoggedById" INTEGER,
    "status" "Status" NOT NULL,

    CONSTRAINT "Logs_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "Logs" ADD CONSTRAINT "Logs_LoggedById_fkey" FOREIGN KEY ("LoggedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
