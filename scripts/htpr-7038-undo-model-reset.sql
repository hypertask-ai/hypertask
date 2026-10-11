-- Manual, reviewed rollback only. Keep backups and per-user completion markers.
-- Preserve choices users changed after the reset, and every unrelated JSON key.
DO $$
DECLARE
    reset_user_id INTEGER;
    setting RECORD;
    choice RECORD;
    path TEXT[];
    preferences JSONB;
BEGIN
    IF to_regclass('htpr_7038_model_choice_backup') IS NULL THEN
        RETURN;
    END IF;
    -- Include users whose first reset may not have committed its backup yet.
    FOR reset_user_id IN SELECT "userId" FROM "UserSetting" ORDER BY "userId"
    LOOP
        PERFORM pg_advisory_xact_lock(7038, reset_user_id);
        SELECT s."userId", s."aiModelPreferences" INTO setting
        FROM "UserSetting" s
        WHERE s."userId" = reset_user_id AND EXISTS (
            SELECT 1 FROM htpr_7038_model_choice_backup b WHERE b.user_id = s."userId"
        )
        FOR UPDATE;
        IF NOT FOUND THEN
            CONTINUE;
        END IF;
        preferences := setting."aiModelPreferences";
        FOR choice IN
            SELECT location, previous_value FROM htpr_7038_model_choice_backup
            WHERE user_id = setting."userId" ORDER BY location
        LOOP
            path := ARRAY(SELECT jsonb_array_elements_text(choice.location::jsonb));
            IF preferences #> path = '"claude-haiku-5-5"'::jsonb THEN
                preferences := jsonb_set(preferences, path, to_jsonb(choice.previous_value), false);
            END IF;
        END LOOP;
        IF preferences IS DISTINCT FROM setting."aiModelPreferences" THEN
            UPDATE "UserSetting" SET "aiModelPreferences" = preferences
            WHERE "userId" = setting."userId";
        END IF;
    END LOOP;
END $$;
