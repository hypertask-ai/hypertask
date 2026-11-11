BEGIN;
SELECT pg_advisory_xact_lock(9019, user_id) FROM htpr_9019_model_choice_auto_done ORDER BY user_id;
UPDATE "UserSetting" s SET "aiModelPreferences" = d.previous_preferences
FROM htpr_9019_model_choice_auto_done d
WHERE s."userId" = d.user_id AND s.xmin = d.xmin
  AND s."aiModelPreferences" IS DISTINCT FROM d.previous_preferences;
COMMIT;
