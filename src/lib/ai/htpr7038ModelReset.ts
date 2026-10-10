import { cache } from "react";
import prisma from "@/lib/prisma";
import { isFeatureEnabled } from "@/lib/flags";
import { HTPR_7038_RESET_SAVED_MODEL_CHOICES_FLAG } from "@/lib/flags/keys";
import { getRedis } from "@/lib/redis";

export type Htpr7038ModelResetResult = "disabled" | "done" | "reset" | "failed";

// Only "reset" requires bypassing a pre-reset preferences cache entry.
export const ensureHtpr7038ModelReset = cache(async (userId: number): Promise<Htpr7038ModelResetResult> => {
  try {
    if (!(await isFeatureEnabled(HTPR_7038_RESET_SAVED_MODEL_CHOICES_FLAG, userId))) {
      return "disabled";
    }
    const done = await prisma.htpr7038ModelChoiceResetDone.findUnique({
      where: { userId },
      select: { userId: true },
    });
    if (done) return "done";

    const changed = await prisma.$transaction(async (tx) => {
      // Same-user resets serialize, including users without a settings row.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(7038, ${userId})`;
      const marker = await tx.htpr7038ModelChoiceResetDone.createMany({
        data: { userId },
        skipDuplicates: true,
      });
      if (!marker.count) return false;
      // Lock before reading JSON, so preference saves cannot be overwritten.
      await tx.$queryRaw`SELECT "userId" FROM "UserSetting" WHERE "userId" = ${userId} FOR UPDATE`;
      const updated = await tx.$executeRaw`
        WITH RECURSIVE setting AS (
          SELECT "userId", "aiModelPreferences" AS preferences
          FROM "UserSetting" WHERE "userId" = ${userId}
        ), surfaces(surface) AS (
          VALUES ('aiChat'), ('taskWriter'), ('writeWithAi'), ('improveWriting'), ('askAi')
        ), choices AS (
          SELECT ARRAY[surface] AS path, preferences -> surface AS value
          FROM setting CROSS JOIN surfaces
          UNION ALL
          SELECT ARRAY['teams', team.key, surface], team.value -> surface
          FROM setting
          CROSS JOIN LATERAL jsonb_each(
            CASE WHEN jsonb_typeof(preferences -> 'teams') = 'object'
                 THEN preferences -> 'teams' ELSE '{}'::jsonb END
          ) team
          CROSS JOIN surfaces
          WHERE jsonb_typeof(team.value) = 'object'
        ), changes AS (
          SELECT path, value, row_number() OVER (ORDER BY path) AS n
          FROM choices
          WHERE jsonb_typeof(value) = 'string'
            AND value <> '"claude-haiku-5-5"'::jsonb
        ), backup AS (
          INSERT INTO htpr_7038_model_choice_backup (user_id, location, previous_value)
          SELECT ${userId}, to_jsonb(path)::text, value #>> '{}' FROM changes
          ON CONFLICT (user_id, location) DO NOTHING
        ), reset(n, preferences) AS (
          SELECT 0::bigint, preferences FROM setting
          UNION ALL
          SELECT changes.n, jsonb_set(reset.preferences, changes.path, '"claude-haiku-5-5"'::jsonb, false)
          FROM reset JOIN changes ON changes.n = reset.n + 1
        )
        UPDATE "UserSetting" SET "aiModelPreferences" = reset.preferences
        FROM reset
        WHERE "userId" = ${userId} AND reset.n = (SELECT count(*) FROM changes) AND reset.n > 0
      `;
      if (updated > 0) {
        const redis = await getRedis();
        // Roll back on invalidation failure rather than leave cached pre-reset picks.
        await redis.setex(`user:${userId}:user-preferences`, 10, "__invalidated__");
      }
      return updated > 0;
    });
    return changed ? "reset" : "done";
  } catch {
    // Database errors can contain connection details or saved data.
    console.warn("[HTPR-7038] Saved-choice reset failed; continuing with existing preferences");
    return "failed";
  }
});
