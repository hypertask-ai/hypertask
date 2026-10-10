import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_6354_AI_CHAT_ALERTS_FLAG = "htpr-6354-ai-chat-alerts";

export default {
  key: HTPR_6354_AI_CHAT_ALERTS_FLAG,
  shippedOn: "2026-10-03",
  description:
    "Sends bounded AI Chat error-rate and latency incidents and recovery messages to Manager, with metadata-only monitoring and three retries.",
  releaseRisk: {
    "risk": "none",
    "reason": "Monitors AI chat reliability and alerts the Manager without changing the app interface."
  },
  kind: "feature",
} as const satisfies FeatureFlagDefinition;
