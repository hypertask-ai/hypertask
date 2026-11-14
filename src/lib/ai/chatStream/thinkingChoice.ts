import { HTPR_9004_THINKING_EFFORT_FLAG } from "@/lib/flags/definitions/htpr-9004-thinking-effort";
import { AUTO_MODEL_OPTION_ID } from "@/lib/aiModelOptions";
import { parseAiThinkingPreference, thinkingPreferenceToEffort } from "@/lib/aiThinkingPreference";
import type { ReasoningEffort } from "@/app/api/ai/_lib/reasoningEffort";

export async function userThinkingChoice(userId: number, modelOptionId?: string | null): Promise<ReasoningEffort | null> {
  if (modelOptionId?.trim() === AUTO_MODEL_OPTION_ID) return null;
  try {
    const { isFeatureEnabled } = require("@/lib/flags") as typeof import("@/lib/flags");
    if (!await isFeatureEnabled(HTPR_9004_THINKING_EFFORT_FLAG, userId)) return null;
    const prisma = (require("@/lib/prisma") as typeof import("@/lib/prisma")).default;
    const setting = await prisma.userSetting.findUnique({
      where: { userId },
      select: { aiModelPreferences: true },
    });
    const stored = setting?.aiModelPreferences as { thinking?: unknown } | null | undefined;
    return thinkingPreferenceToEffort(parseAiThinkingPreference(stored?.thinking));
  } catch {
    return null;
  }
}
