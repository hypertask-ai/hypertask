import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7844_TEAM_AI_KEY_ONLY_FLAG = "htpr-7844-team-ai-key-only";

export default {
  key: HTPR_7844_TEAM_AI_KEY_ONLY_FLAG,
  kind: "feature",
  defaultMode: "OFF",
  shippedOn: "2026-10-24",
  description: "Team key-only AI funding. A team marked key-only uses its own saved keys and never a platform key.",
  releaseRisk: {
    risk: "new",
    highRisk: "money",
    reason: "Stops platform, gateway, demo, embedding and dictation keys from paying for a key-only team's AI. Off keeps today's funding.",
  },
} as const satisfies FeatureFlagDefinition;
