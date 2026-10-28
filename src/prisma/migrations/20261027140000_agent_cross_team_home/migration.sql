ALTER TABLE "Agent"
  ADD COLUMN "boardHomeTeamId" TEXT,
  ADD COLUMN "crossTeamHomeTeamId" TEXT,
  ADD COLUMN "crossTeamAccessGranted" BOOLEAN NOT NULL DEFAULT false;

UPDATE "Agent" AS a
SET "boardHomeTeamId" = COALESCE(
  (SELECT s."teamId" FROM "ChatSession" AS s
   WHERE s."agentId" = a.id AND s."teamId" IS NOT NULL
   ORDER BY s."createdAt", s.id LIMIT 1),
  (SELECT p."teamId" FROM "Member" AS m
   JOIN "Project" AS p ON p.id = m."projectId"
   WHERE m."agentId" = a.id AND p."teamId" IS NOT NULL
   ORDER BY m.id LIMIT 1)
);
