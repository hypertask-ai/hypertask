DO $$
DECLARE
    target_user INTEGER;
    setting RECORD;
    choice RECORD;
    path TEXT[];
    preferences JSONB;
BEGIN
    IF to_regclass('htpr_9019_model_choice_backup') IS NULL THEN
        RETURN;
    END IF;
    FOR target_user IN
        SELECT DISTINCT user_id FROM htpr_9019_model_choice_backup ORDER BY user_id
    LOOP
        PERFORM pg_advisory_xact_lock(9019, target_user);
        SELECT s."userId", s."aiModelPreferences" INTO setting
        FROM "UserSetting" s WHERE s."userId" = target_user FOR UPDATE;
        IF NOT FOUND OR setting."aiModelPreferences" IS NULL THEN
            CONTINUE;
        END IF;
        preferences := setting."aiModelPreferences";
        FOR choice IN
            SELECT location, previous_value FROM htpr_9019_model_choice_backup
            WHERE user_id = target_user ORDER BY location
        LOOP
            path := ARRAY(SELECT jsonb_array_elements_text(choice.location::jsonb));
            IF preferences #> path = '"auto"'::jsonb THEN
                preferences := jsonb_set(preferences, path, to_jsonb(choice.previous_value), false);
            END IF;
        END LOOP;
        IF preferences IS DISTINCT FROM setting."aiModelPreferences" THEN
            UPDATE "UserSetting" SET "aiModelPreferences" = preferences
            WHERE "userId" = setting."userId";
        END IF;
    END LOOP;
END $$;
