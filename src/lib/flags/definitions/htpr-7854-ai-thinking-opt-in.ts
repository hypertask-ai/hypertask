import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7854_AI_THINKING_OPT_IN_FLAG = "htpr-7854-ai-thinking-opt-in";

export default {
  key: HTPR_7854_AI_THINKING_OPT_IN_FLAG,
  kind: "improvement",
  defaultMode: "OFF",
  shippedOn: "2026-10-24",
  description: "Sends each AI feature the reasoning effort from one map. Off keeps today's adaptive medium default.",
  releaseRisk: {
    risk: "small",
    highRisk: "money",
    reason: "Reasoning tokens are billed as model output. The map lowers that spend on titles, summaries, labels, heartbeats and questions, and keeps low effort on chat, task writer and mentions.",
  },
} as const satisfies FeatureFlagDefinition;
