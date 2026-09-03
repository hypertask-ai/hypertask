CREATE TYPE "AgentVisibility" AS ENUM ('PRIVATE', 'TEAM');

ALTER TABLE "Agent"
ADD COLUMN "visibility" "AgentVisibility" NOT NULL DEFAULT 'PRIVATE';
