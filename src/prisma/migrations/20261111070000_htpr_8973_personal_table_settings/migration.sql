ALTER TABLE "View_Last_Used" ADD COLUMN "table_sort_stack" JSONB;
ALTER TABLE "View_Last_Used" ADD COLUMN "table_columns" JSONB;

INSERT INTO "View_Last_Used" ("id", "userId", "viewId", "table_sort_stack", "table_columns")
SELECT gen_random_uuid()::text, state."userId", target."id",
  CASE
    WHEN jsonb_typeof(draft."table_sort_stack") = 'array' AND draft."table_sort_stack" <> '[]'::jsonb
      THEN draft."table_sort_stack"
    WHEN draft."table_sort_column" IS NOT NULL AND draft."table_sort_direction" IN ('asc', 'desc')
      THEN jsonb_build_array(jsonb_build_object('column', draft."table_sort_column", 'direction', draft."table_sort_direction"))
    WHEN draft."table_sort_stack" = 'null'::jsonb THEN '[]'::jsonb
    ELSE draft."table_sort_stack"
  END,
  NULLIF(draft."table_columns", 'null'::jsonb)
FROM "User_Project_View" state
JOIN "Project_View" board ON board."id" = state."project_view_id"
JOIN "View" draft ON draft."id" = state."unsavedViewId"
  AND draft."userId" = state."userId" AND draft."project_view_id" = board."id"
JOIN "View" target ON target."id" = COALESCE(state."appliedViewId", board."default_view_id")
  AND target."project_view_id" = board."id"
WHERE draft."table_sort_stack" IS NOT NULL OR draft."table_columns" IS NOT NULL
  OR (draft."table_sort_column" IS NOT NULL AND draft."table_sort_direction" IN ('asc', 'desc'))
ON CONFLICT ("userId", "viewId") DO UPDATE SET
  "table_sort_stack" = COALESCE("View_Last_Used"."table_sort_stack", EXCLUDED."table_sort_stack"),
  "table_columns" = COALESCE("View_Last_Used"."table_columns", EXCLUDED."table_columns");
