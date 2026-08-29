export const INCLUDED_WITH_HYPERTASK_GATEWAY_TAG = "included-with-hypertask";

export const SYSTEM_AI_FEATURES = ["summary", "task-questions"] as const;

export function isSystemAiFeature(feature: string): boolean {
  return (SYSTEM_AI_FEATURES as readonly string[]).includes(feature);
}
