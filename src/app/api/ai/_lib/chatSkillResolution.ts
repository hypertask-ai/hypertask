import { resolveSkills } from "./skills";

export async function resolveSkillsForAiRequest(
  text: string,
  context: Parameters<typeof resolveSkills>[1],
) {
  return resolveSkills(text, context);
}
