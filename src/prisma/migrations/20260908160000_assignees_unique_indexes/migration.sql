-- HTPR-6279: two concurrent assign calls could both pass the check-then-insert
-- path and create identical assignee rows (seen as duplicated assignee chips).
-- Deduplicate existing rows — the oldest row survives so notifications that
-- already point at it keep their link (Notification.assignId is ON DELETE SET
-- NULL for the removed rows) — then block new duplicates with partial unique
-- indexes. Prisma cannot express partial indexes (same as AgentRun_nonterminal_*),
-- so these live here only.

LOCK TABLE "Assignees" IN ACCESS EXCLUSIVE MODE;

-- Person duplicates: same task and user, both rows person rows.
DELETE FROM "Assignees" a
USING "Assignees" b
WHERE a."taskId" = b."taskId"
  AND a."userId" = b."userId"
  AND a."agentId" IS NULL
  AND b."agentId" IS NULL
  AND a."id" > b."id";

-- Agent duplicates: same task and agent, regardless of the owner recorded on
-- the row, so the agentId index can always be created.
DELETE FROM "Assignees" a
USING "Assignees" b
WHERE a."taskId" = b."taskId"
  AND a."agentId" IS NOT NULL
  AND a."agentId" = b."agentId"
  AND a."id" > b."id";

CREATE UNIQUE INDEX "Assignees_taskId_userId_person_key"
    ON "Assignees"("taskId", "userId")
    WHERE "agentId" IS NULL;

CREATE UNIQUE INDEX "Assignees_taskId_agentId_key"
    ON "Assignees"("taskId", "agentId")
    WHERE "agentId" IS NOT NULL;