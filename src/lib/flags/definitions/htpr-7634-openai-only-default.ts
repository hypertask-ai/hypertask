import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7634_OPENAI_ONLY_DEFAULT_FLAG = "htpr-7634-openai-only-default";

export default {
  key: HTPR_7634_OPENAI_ONLY_DEFAULT_FLAG,
  kind: "bugfix",
  defaultMode: "EVERYONE",
  shippedOn: "2026-10-23",
  description: "Defaults paid teams with only a direct OpenAI key to GPT 6 Luna while preserving saved model choices.",
  releaseRisk: {
    risk: "small",
    reason: "Only changes the unsaved default when Claude has no funded route and a direct OpenAI key is available. Off restores the existing default.",
  },
} as const satisfies FeatureFlagDefinition;
