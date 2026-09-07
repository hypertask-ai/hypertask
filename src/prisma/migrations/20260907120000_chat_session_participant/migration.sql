-- HTPR-6002: an agent chat thread is one shared conversation per team and
-- agent, so it needs the team it belongs to and the list of people in it.

-- AlterTable
ALTER TABLE "ChatSession" ADD COLUMN     "teamId" TEXT;

-- CreateTable
CREATE TABLE "ChatSessionParticipant" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "userId" INTEGER NOT NULL,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastReadAt" TIMESTAMP(3),
    "draft" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChatSessionParticipant_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ChatSessionParticipant_userId_idx" ON "ChatSessionParticipant"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "ChatSessionParticipant_sessionId_userId_key" ON "ChatSessionParticipant"("sessionId", "userId");

-- AddForeignKey
ALTER TABLE "ChatSessionParticipant" ADD CONSTRAINT "ChatSessionParticipant_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "ChatSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatSessionParticipant" ADD CONSTRAINT "ChatSessionParticipant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Record the team an existing conversation already belongs to. This is the one
-- deliberate widening in this change: a thread that was one person's becomes
-- readable by that team, history included. That is the point of the ticket, a
-- shared conversation per team and agent, and it is what a merge reviewer
-- needs to see. It applies only where the agent's boards agree on one team;
-- an agent whose boards span two keeps a null team and stays with its creator.
-- Boards with no team of their own are ignored rather than counted as a second
-- scope, matching how getAgentTeamIds resolves the same question at runtime.
UPDATE "ChatSession" AS s
SET "teamId" = agent_team."teamId"
FROM (
    SELECT m."agentId" AS "agentId", MIN(p."teamId") AS "teamId"
    FROM "Member" m
    JOIN "Project" p ON p."id" = m."projectId"
    WHERE m."agentId" IS NOT NULL AND p."teamId" IS NOT NULL
    GROUP BY m."agentId"
    HAVING COUNT(DISTINCT p."teamId") = 1
) AS agent_team
WHERE s."agentId" = agent_team."agentId" AND s."teamId" IS NULL;

-- Seed the participant list from who is already in each thread: the person who
-- opened it, plus everyone who has written in it. lastReadAt is set to now so
-- nobody wakes up to a badge counting messages they have already read.
INSERT INTO "ChatSessionParticipant" ("id", "sessionId", "userId", "joinedAt", "lastReadAt", "updatedAt")
SELECT md5(random()::text || clock_timestamp()::text), s."id", participant."userId", NOW(), NOW(), NOW()
FROM "ChatSession" s
JOIN LATERAL (
    SELECT s."userId" AS "userId"
    UNION
    SELECT m."authorUserId"
    FROM "ChatMessage" m
    WHERE m."sessionId" = s."id" AND m."authorUserId" IS NOT NULL
) AS participant ON TRUE
WHERE s."agentId" IS NOT NULL
ON CONFLICT ("sessionId", "userId") DO NOTHING;

-- The stored team decides who may read the thread, so it should not be able to
-- point at a team that no longer exists. SET NULL, not CASCADE: deleting a team
-- must not delete a transcript, and a thread with no team falls back to the
-- person who opened it.
-- Postgres indexes the referenced side of a foreign key, never the referencing
-- one, so without this every team deletion scans ChatSession in full to find
-- the rows it has to null out. The two foreign keys above are already covered
-- by the indexes created with the table; this is the one left.
CREATE INDEX "ChatSession_teamId_idx" ON "ChatSession"("teamId");

ALTER TABLE "ChatSession" ADD CONSTRAINT "ChatSession_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE SET NULL ON UPDATE CASCADE;
