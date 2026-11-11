import { cache } from "react";
import prisma from "@/lib/prisma";
import { getRedis } from "@/lib/redis";
import { featureFlagCandidateUserIds, isFeatureEnabled } from "@/lib/flags";
import { HTPR_9019_SAVED_MODEL_AUTO_FLAG } from "@/lib/flags/definitions/htpr-9019-saved-model-auto";
import { HTPR_7915_AUTO_MODEL_FLAG } from "@/lib/flags/definitions/htpr-7915-auto-model";

export type Htpr9019ModelChoiceAutoResult = "done" | "switched" | "failed";

export async function sweepHtpr9019ModelChoices() {
  const audiences = await Promise.all([
    featureFlagCandidateUserIds(HTPR_9019_SAVED_MODEL_AUTO_FLAG),
    featureFlagCandidateUserIds(HTPR_7915_AUTO_MODEL_FLAG),
  ]);
  if (audiences.some((audience) => audience !== null)) {
    return { skipped: "waiting for Everyone" };
  }

  const users = await prisma.$queryRaw<{ userId: number }[]>`
    SELECT settings."userId" FROM "UserSetting" settings
    WHERE NOT EXISTS (
      SELECT 1 FROM htpr_9019_model_choice_auto_done done WHERE done.user_id = settings."userId"
    )
    ORDER BY settings."userId" LIMIT 100
  `;
  let switched = 0;
  const failed: number[] = [];
  for (const { userId } of users) {
    const result = await ensureHtpr9019ModelChoiceAuto(userId);
    if (result === "switched") switched++;
    if (result === "failed") failed.push(userId);
  }
  const [coverage] = await prisma.$queryRaw<{ remaining: bigint }[]>`
    SELECT count(*) AS remaining FROM "UserSetting" settings
    WHERE NOT EXISTS (
      SELECT 1 FROM htpr_9019_model_choice_auto_done done WHERE done.user_id = settings."userId"
    )
  `;
  return { scanned: users.length, switched, failed, remaining: Number(coverage.remaining) };
}

export const ensureHtpr9019ModelChoiceAuto = cache(async (userId: number): Promise<Htpr9019ModelChoiceAutoResult> => {
  try {
    const done = await prisma.htpr9019ModelChoiceAutoDone.findUnique({ where: { userId }, select: { userId: true } });
    if (done) return "done";
    if (!(await isFeatureEnabled(HTPR_9019_SAVED_MODEL_AUTO_FLAG, userId))) return "done";
    if (!(await isFeatureEnabled(HTPR_7915_AUTO_MODEL_FLAG, userId))) return "done";

    const switched = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(7038, ${userId})`;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(9019, ${userId})`;
      const marker = await tx.htpr9019ModelChoiceAutoDone.createMany({ data: { userId }, skipDuplicates: true });
      if (!marker.count) return false;
      await tx.$queryRaw`SELECT "userId" FROM "UserSetting" WHERE "userId" = ${userId} FOR UPDATE`;
      const updated = await tx.$executeRaw`
        WITH RECURSIVE setting AS (
          SELECT "userId", "aiModelPreferences" AS preferences FROM "UserSetting" WHERE "userId" = ${userId}
        ), surfaces(surface) AS (
          VALUES ('aiChat'), ('taskWriter'), ('writeWithAi'), ('improveWriting'), ('askAi')
        ), choices AS (
          SELECT ARRAY[surface] AS path, preferences -> surface AS value FROM setting CROSS JOIN surfaces
          UNION ALL
          SELECT ARRAY['teams', team.key, surface], team.value -> surface FROM setting
          CROSS JOIN LATERAL jsonb_each(
            CASE WHEN jsonb_typeof(preferences -> 'teams') = 'object' THEN preferences -> 'teams' ELSE '{}'::jsonb END
          ) team CROSS JOIN surfaces
          WHERE jsonb_typeof(team.value) = 'object'
        ), changes AS (
          SELECT path, value, row_number() OVER (ORDER BY path) AS n FROM choices
          WHERE jsonb_typeof(value) = 'string' AND value <> '"auto"'::jsonb
        ), backup AS (
          INSERT INTO htpr_9019_model_choice_backup (user_id, location, previous_value)
          SELECT ${userId}, to_jsonb(path)::text, value #>> '{}' FROM changes
          ON CONFLICT (user_id, location) DO NOTHING
        ), switched(n, preferences) AS (
          SELECT 0::bigint, preferences FROM setting
          UNION ALL
          SELECT changes.n, jsonb_set(switched.preferences, changes.path, '"auto"'::jsonb, false)
          FROM switched JOIN changes ON changes.n = switched.n + 1
        )
        UPDATE "UserSetting" SET "aiModelPreferences" = switched.preferences FROM switched
        WHERE "userId" = ${userId} AND switched.n = (SELECT count(*) FROM changes) AND switched.n > 0
      `;
      await tx.$executeRaw`
        INSERT INTO htpr_7038_model_choice_reset_done (user_id) VALUES (${userId}) ON CONFLICT (user_id) DO NOTHING
      `;
      if (updated > 0) {
        const redis = await getRedis();
        await redis.setex(`user:${userId}:user-preferences`, 10, "__invalidated__");
      }
      return updated > 0;
    });
    return switched ? "switched" : "done";
  } catch {
    console.warn("[HTPR-9019] Saved-choice switch failed; continuing with existing preferences");
    return "failed";
  }
});
