BEGIN;

LOCK TABLE "Page" IN ACCESS EXCLUSIVE MODE;

INSERT INTO "PageTaskLink" ("pageId", "taskId", "createdById", "agentId", "createdAt")
SELECT p."id", p."taskId", p."createdById", p."agentId", p."createdAt"
FROM "Page" p
WHERE p."taskId" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM "PageTaskLink" l
    WHERE l."pageId" = p."id"
  )
ON CONFLICT ("pageId", "taskId") DO NOTHING;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "Page" p
    WHERE p."taskId" IS NOT NULL
      AND NOT EXISTS (
        SELECT 1
        FROM "PageTaskLink" l
        WHERE l."pageId" = p."id"
      )
  ) THEN
    RAISE EXCEPTION 'HTPR-7310: page with origin ticket has no PageTaskLink rows';
  END IF;
END $$;

COMMIT;
