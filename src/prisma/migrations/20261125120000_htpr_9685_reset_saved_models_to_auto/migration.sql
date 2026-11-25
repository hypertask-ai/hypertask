WITH RECURSIVE surfaces(surface) AS (
  VALUES ('aiChat'), ('taskWriter'), ('writeWithAi'), ('improveWriting'), ('askAi')
), eligible AS (
  SELECT "userId", "aiModelPreferences" AS preferences
  FROM "UserSetting"
  WHERE "aiModelPreferences" IS NOT NULL
    AND jsonb_typeof("aiModelPreferences") = 'object'
), choices AS (
  SELECT e."userId", ARRAY[s.surface] AS path, e.preferences -> s.surface AS value
  FROM eligible e
  CROSS JOIN surfaces s
  UNION ALL
  SELECT e."userId", ARRAY['teams', team.key, s.surface] AS path, team.value -> s.surface AS value
  FROM eligible e
  CROSS JOIN LATERAL jsonb_each(
    CASE WHEN jsonb_typeof(e.preferences -> 'teams') = 'object'
         THEN e.preferences -> 'teams' ELSE '{}'::jsonb END
  ) team
  CROSS JOIN surfaces s
  WHERE jsonb_typeof(team.value) = 'object'
), changes AS (
  SELECT
    "userId",
    path,
    row_number() OVER (PARTITION BY "userId" ORDER BY path) AS n,
    count(*) OVER (PARTITION BY "userId") AS total
  FROM choices
  WHERE jsonb_typeof(value) = 'string'
    AND value <> '"auto"'::jsonb
), reset AS (
  SELECT DISTINCT e."userId", 0::bigint AS n, e.preferences
  FROM eligible e
  JOIN changes c ON c."userId" = e."userId"
  UNION ALL
  SELECT r."userId", c.n, jsonb_set(r.preferences, c.path, '"auto"'::jsonb, false)
  FROM reset r
  JOIN changes c ON c."userId" = r."userId" AND c.n = r.n + 1
), final_reset AS (
  SELECT r."userId", r.preferences
  FROM reset r
  JOIN (SELECT "userId", MAX(total) AS total FROM changes GROUP BY "userId") t
    ON t."userId" = r."userId" AND r.n = t.total
)
UPDATE "UserSetting" u
SET "aiModelPreferences" = f.preferences
FROM final_reset f
WHERE u."userId" = f."userId";

UPDATE "AI_Custom_Instructions"
SET "model_selected" = 'auto',
    "source_selected" = NULL
WHERE "model_selected" IS NOT NULL
  AND "model_selected" <> 'auto';

INSERT INTO htpr_7038_model_choice_reset_done (user_id)
SELECT "userId" FROM "UserSetting"
ON CONFLICT (user_id) DO NOTHING;
