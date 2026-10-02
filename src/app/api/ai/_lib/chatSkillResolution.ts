import { resolveSkills } from "./skills";

export async function resolveSkillsForAiRequest(
  text: string,
  context: { userId: number; projectId?: number },
) {
  return resolveSkills(text, context);
}
