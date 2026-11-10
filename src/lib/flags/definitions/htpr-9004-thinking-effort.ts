import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_9004_THINKING_EFFORT_FLAG = "htpr-9004-thinking-effort";

export default {
  key: HTPR_9004_THINKING_EFFORT_FLAG,
  kind: "feature",
  defaultMode: "OWNER_AND_QA",
  shippedOn: "2026-11-10",
  description: "Adds a Thinking switch and an Effort level to the AI chat model selector. Thinking starts off. Off keeps today's behavior.",
  related: ["htpr-7854-ai-thinking-opt-in"],
  releaseRisk: {
    risk: "small",
    highRisk: "money",
    reason: "Thinking tokens are billed as model output. Thinking stays off until the user switches it on, and nothing changes for users without the flag.",
  },
} as const satisfies FeatureFlagDefinition;
