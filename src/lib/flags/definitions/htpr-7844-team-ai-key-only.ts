import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7844_TEAM_AI_KEY_ONLY_FLAG = "htpr-7844-team-ai-key-only";

export default {
  key: HTPR_7844_TEAM_AI_KEY_ONLY_FLAG,
  kind: "feature",
  defaultMode: "OWNER_AND_QA",
  shippedOn: "2026-10-24",
  description: "Team key-only AI uses its Anthropic key; explicitly approved teams may use platform funding for search embeddings and dictation.",
  releaseRisk: {
    risk: "new",
    highRisk: "money",
    reason: "Key-only teams use Anthropic BYOK; explicit team opt-in permits platform-funded embeddings and dictation. Off pauses AI for marked teams; other teams keep existing funding.",
  },
} as const satisfies FeatureFlagDefinition;
