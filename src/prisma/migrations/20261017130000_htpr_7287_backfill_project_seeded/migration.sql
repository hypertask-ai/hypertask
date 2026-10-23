UPDATE "Project" AS p
SET "seeded" = true
WHERE p."seeded" = false
  AND (
    EXISTS (
      SELECT 1
      FROM "Task" AS t
      WHERE t."projectId" = p."id"
        AND t."userId" = 332
        AND t."title" = 'Connect Hypertask to Claude or ChatGPT'
        AND t."createdAt" BETWEEN p."createdAt" AND p."createdAt" + interval '10 minutes'
    )
    OR EXISTS (
      SELECT 1
      FROM "Task" AS t
      JOIN "User" AS u ON u."id" = t."userId"
      WHERE t."projectId" = p."id"
        AND (u."uid" LIKE 'guest\_%' OR u."uid" LIKE 'exguest\_%')
        AND p."createdAt" >= u."joinedAt"
        AND t."createdAt" BETWEEN p."createdAt" AND p."createdAt" + interval '10 minutes'
    )
  );
