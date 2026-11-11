BEGIN;
SELECT pg_advisory_xact_lock(9019, user_id) FROM htpr_9019_model_choice_backup GROUP BY user_id ORDER BY user_id;
SELECT "userId" FROM "UserSetting" WHERE "userId" IN (SELECT user_id FROM htpr_9019_model_choice_backup) FOR UPDATE;
WITH RECURSIVE choices AS (
    SELECT user_id, ARRAY(SELECT jsonb_array_elements_text(location::jsonb)) AS path, previous_value,
           row_number() OVER (PARTITION BY user_id ORDER BY location) AS n
    FROM htpr_9019_model_choice_backup
), restored(user_id, n, preferences) AS (
    SELECT s."userId", 0::bigint, s."aiModelPreferences" FROM "UserSetting" s
    JOIN htpr_9019_model_choice_auto_done d ON d.user_id = s."userId" AND d.xmin = s.xmin
    WHERE s."userId" IN (SELECT user_id FROM choices)
    UNION ALL
    SELECT r.user_id, c.n, jsonb_set(r.preferences, c.path, to_jsonb(c.previous_value), false)
    FROM restored r JOIN choices c ON c.user_id = r.user_id AND c.n = r.n + 1
)
UPDATE "UserSetting" s SET "aiModelPreferences" = r.preferences FROM restored r
WHERE s."userId" = r.user_id AND r.n = (SELECT count(*) FROM choices c WHERE c.user_id = r.user_id)
      AND s."aiModelPreferences" IS DISTINCT FROM r.preferences;
COMMIT;
