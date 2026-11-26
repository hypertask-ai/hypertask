import { cache } from "react";
import type { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { getRedis } from "@/lib/redis";
import { featureFlagCandidateUserIds, isFeatureEnabled } from "@/lib/flags";
import { HTPR_9019_SAVED_MODEL_AUTO_FLAG } from "@/lib/flags/definitions/htpr-9019-saved-model-auto";
import { HTPR_7915_AUTO_MODEL_FLAG } from "@/lib/flags/definitions/htpr-7915-auto-model";

export async function sweepHtpr9019ModelChoices() {
  const audiences = await Promise.all(
    [HTPR_9019_SAVED_MODEL_AUTO_FLAG, HTPR_7915_AUTO_MODEL_FLAG].map((key) => featureFlagCandidateUserIds(key)),
  );
  if (audiences.some((audience) => audience !== null)) return { skipped: "waiting for Everyone" };
  const users = await prisma.$queryRaw<{ userId: number }[]>`
    SELECT settings."userId" FROM "UserSetting" settings
    LEFT JOIN htpr_9019_model_choice_auto_done done ON done.user_id = settings."userId"
    WHERE done.user_id IS NULL ORDER BY settings."userId" LIMIT 100
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
    LEFT JOIN htpr_9019_model_choice_auto_done done ON done.user_id = settings."userId"
    WHERE done.user_id IS NULL
  `;
  return { scanned: users.length, switched, failed, remaining: Number(coverage.remaining) };
}

export const ensureHtpr9019ModelChoiceAuto = cache(async (userId: number): Promise<"done" | "switched" | "failed"> => {
  try {
    const done = await prisma.htpr9019ModelChoiceAutoDone.findUnique({ where: { userId }, select: { userId: true } });
    if (done) return "done";
    if (!(await isFeatureEnabled(HTPR_9019_SAVED_MODEL_AUTO_FLAG, userId))) return "done";
    if (!(await isFeatureEnabled(HTPR_7915_AUTO_MODEL_FLAG, userId))) return "done";

    const switched = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(7038, ${userId}::int)`;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(9019, ${userId}::int)`;
      const [setting] = await tx.$queryRaw<{ preferences: Prisma.JsonValue }[]>`
        SELECT "aiModelPreferences" AS preferences FROM "UserSetting" WHERE "userId" = ${userId} FOR UPDATE
      `;
      const marker = await tx.$executeRaw`
        INSERT INTO htpr_9019_model_choice_auto_done (user_id, previous_preferences)
        VALUES (${userId}, (SELECT "aiModelPreferences" FROM "UserSetting" WHERE "userId" = ${userId}))
        ON CONFLICT (user_id) DO NOTHING
      `;
      if (!marker) return false;
      let updated = false;
      const preferences = setting?.preferences;
      if (preferences && typeof preferences === "object" && !Array.isArray(preferences)) {
        for (const scope of [preferences, ...Object.values(
          preferences.teams && typeof preferences.teams === "object" && !Array.isArray(preferences.teams) ? preferences.teams : {},
        )]) {
          if (!scope || typeof scope !== "object" || Array.isArray(scope)) continue;
          for (const surface of ["aiChat", "taskWriter", "writeWithAi", "improveWriting", "askAi"]) {
            if (typeof scope[surface] !== "string" || scope[surface] === "auto") continue;
            scope[surface] = "auto";
            updated = true;
          }
        }
      }
      if (updated) await tx.$executeRaw`
        UPDATE "UserSetting" SET "aiModelPreferences" = ${JSON.stringify(preferences)}::jsonb WHERE "userId" = ${userId}
      `;
      await tx.$executeRaw`INSERT INTO htpr_7038_model_choice_reset_done (user_id) VALUES (${userId}) ON CONFLICT (user_id) DO NOTHING`;
      if (updated) await (await getRedis()).setex(`user:${userId}:user-preferences`, 10, "__invalidated__");
      return updated;
    });
    return switched ? "switched" : "done";
  } catch {
    console.warn("[HTPR-9019] Saved-choice switch failed; continuing with existing preferences");
    return "failed";
  }
});
