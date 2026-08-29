-- AlterTable
ALTER TABLE "Follower" ADD COLUMN     "agentId" TEXT;

-- AddForeignKey
ALTER TABLE "Follower" ADD CONSTRAINT "Follower_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE SET NULL ON UPDATE CASCADE;
