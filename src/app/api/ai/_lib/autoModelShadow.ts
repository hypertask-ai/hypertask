import { isFeatureEnabled } from "@/lib/flags";
import { HTPR_9048_JEV_AUTO_MODEL_SHADOW_FLAG } from "@/lib/flags/definitions/htpr-9048-jev-auto-model-shadow";

export async function autoModelShadowEnabled(userId: number | null | undefined): Promise<boolean> {
  if (typeof userId !== "number" || !Number.isInteger(userId) || userId <= 0) return false;
  try {
    if (await isFeatureEnabled(HTPR_9048_JEV_AUTO_MODEL_SHADOW_FLAG, userId)) return true;
    return false;
  } catch {
    return false;
  }
}
