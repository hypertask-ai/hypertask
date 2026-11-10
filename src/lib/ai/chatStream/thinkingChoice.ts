import { HTPR_9004_THINKING_EFFORT_FLAG } from "@/lib/flags/definitions/htpr-9004-thinking-effort";
import { parseAiThinkingPreference, thinkingPreferenceToEffort } from "@/lib/aiThinkingPreference";
import type { ReasoningEffort } from "@/app/api/ai/_lib/reasoningEffort";

export async function userThinkingChoice(userId: number): Promise<ReasoningEffort | null> {
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
