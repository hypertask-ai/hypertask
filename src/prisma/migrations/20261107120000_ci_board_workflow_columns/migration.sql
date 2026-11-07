INSERT INTO "Section" ("section_title", "projectId", "visibility", "deleted", "ranking", "isDone")
SELECT workflow.title, 11514, true, false, workflow.ranking, false
FROM (
  VALUES
    ('Blocked', 'A0330', 'blocked'),
    ('QA', 'A0505', 'qa'),
    ('Release', 'A0525', 'release')
) AS workflow(title, ranking, word)
WHERE EXISTS (
  SELECT 1 FROM "Project" WHERE id = 11514 AND status = 'Normal'
)
AND NOT EXISTS (
  SELECT 1 FROM "Section"
  WHERE "projectId" = 11514
    AND deleted = false
    AND "section_title" ~* ('(^|[^[:alnum:]])' || workflow.word || '([^[:alnum:]]|$)')
);
