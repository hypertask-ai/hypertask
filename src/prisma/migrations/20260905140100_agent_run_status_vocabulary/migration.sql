-- Turn states this codebase could not express: a run accepted but not started,
-- a run that ended in an error, and a queued run that never started in time.
-- Its own migration because Postgres cannot use a new enum value in the same
-- transaction that adds it.
ALTER TYPE "AgentRunStatus" ADD VALUE IF NOT EXISTS 'QUEUED';
ALTER TYPE "AgentRunStatus" ADD VALUE IF NOT EXISTS 'FAILED';
ALTER TYPE "AgentRunStatus" ADD VALUE IF NOT EXISTS 'EXPIRED';
