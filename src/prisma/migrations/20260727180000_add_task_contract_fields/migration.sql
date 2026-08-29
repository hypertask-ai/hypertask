-- HTPR-4622: add structured contract fields to tasks.
CREATE TYPE "RiskLevel" AS ENUM ('Low', 'Medium', 'High');
ALTER TABLE "Task" ADD COLUMN "riskLevel" "RiskLevel";
ALTER TABLE "Task" ADD COLUMN "acceptanceCriteria" TEXT;
ALTER TABLE "Task" ADD COLUMN "verifyCommand" TEXT;
