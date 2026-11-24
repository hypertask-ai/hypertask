ALTER TABLE "Project" ADD COLUMN "issuedUniqueIndex" INTEGER NOT NULL DEFAULT 0;

UPDATE "Project" AS p
SET "issuedUniqueIndex" = issued.max_index
FROM (
  SELECT "projectId", MAX("uniqueIndex") AS max_index
  FROM (
    SELECT "projectId", "uniqueIndex" FROM "Task"
    UNION ALL
    SELECT "projectId", "uniqueIndex" FROM "TaskNumberAlias"
  ) AS numbers
  GROUP BY "projectId"
) AS issued
WHERE p.id = issued."projectId";
