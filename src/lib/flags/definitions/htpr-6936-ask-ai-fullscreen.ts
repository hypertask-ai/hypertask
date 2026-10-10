import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_6936_ASK_AI_FULLSCREEN_FLAG = "htpr-6936-ask-ai-fullscreen";

export default {
  key: HTPR_6936_ASK_AI_FULLSCREEN_FLAG,
  kind: "feature",
  shippedOn: "2026-10-04",
  description: "Opens Ask AI from search in the existing full-screen AI chat, sends the question in a new conversation and keeps the search query for Back.",
  releaseRisk: {
    "risk": "small",
    "reason": "Ask AI from search opens the existing full-screen chat and preserves the query for Back."
  },
} as const satisfies FeatureFlagDefinition;
