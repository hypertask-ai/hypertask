import { AGENT_CHAT_SKILLS_FLAG, isFeatureEnabled } from "@/lib/flags";

import { resolveSkills } from "./skills";

type AiFeature = "aiChat" | "askAi";
type FlagErrorHandler = (error: unknown) => Promise<void> | void;

export async function resolveSkillsForAiRequest(
  text: string,
  context: { userId: number; projectId?: number },
  aiFeature: AiFeature,
  onFlagError: FlagErrorHandler,
) {
  let allowInstalledSkills = true;
  if (aiFeature === "aiChat") {
    try {
      allowInstalledSkills = await isFeatureEnabled(
        AGENT_CHAT_SKILLS_FLAG,
        context.userId,
      );
    } catch (error) {
      await onFlagError(error);
      allowInstalledSkills = false;
    }
  }

  return resolveSkills(text, { ...context, allowInstalledSkills });
}
