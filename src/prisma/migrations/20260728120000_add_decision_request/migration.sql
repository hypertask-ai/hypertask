-- HTPR-4444: durable requests for human decisions on tasks.
CREATE TYPE "DecisionRequestStatus" AS ENUM ('Pending', 'Answered', 'Cancelled');

CREATE TABLE "DecisionRequest" (
    "id" SERIAL NOT NULL,
    "taskId" INTEGER NOT NULL,
    "question" TEXT NOT NULL,
    "options" JSONB NOT NULL,
    "status" "DecisionRequestStatus" NOT NULL DEFAULT 'Pending',
    "answer" TEXT,
    "answerNote" TEXT,
    "createdById" INTEGER,
    "agentId" TEXT,
    "answeredById" INTEGER,
    "answeredAt" TIMESTAMP(3),
    "commentId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3),
    CONSTRAINT "DecisionRequest_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "DecisionRequest_taskId_status_idx" ON "DecisionRequest"("taskId", "status");

ALTER TABLE "DecisionRequest" ADD CONSTRAINT "DecisionRequest_taskId_fkey"
    FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DecisionRequest" ADD CONSTRAINT "DecisionRequest_createdById_fkey"
    FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "DecisionRequest" ADD CONSTRAINT "DecisionRequest_agentId_fkey"
    FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "DecisionRequest" ADD CONSTRAINT "DecisionRequest_answeredById_fkey"
    FOREIGN KEY ("answeredById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "DecisionRequest" ADD CONSTRAINT "DecisionRequest_commentId_fkey"
    FOREIGN KEY ("commentId") REFERENCES "Comment"("id") ON DELETE SET NULL ON UPDATE CASCADE;
