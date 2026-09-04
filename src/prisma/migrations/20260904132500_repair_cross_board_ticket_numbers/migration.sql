-- Repair task identifiers left stale by cross-board moves before HTPR-6121.
UPDATE "Task" AS task
SET "ticketNumber" = BTRIM(project."uniqueIdentifier") || '-' || task."uniqueIndex"::text
FROM "Project" AS project
WHERE project."id" = task."projectId"
  AND task."uniqueIndex" > 0
  AND NULLIF(BTRIM(project."uniqueIdentifier"), '') IS NOT NULL
  AND task."ticketNumber" IS DISTINCT FROM (
    BTRIM(project."uniqueIdentifier") || '-' || task."uniqueIndex"::text
  );
