import type { FeatureFlagDefinition } from "../definitions";

export const SHARED_AGENT_CHAT_FLAG = "htpr-6002-shared-agent-chat";

export default {
  key: SHARED_AGENT_CHAT_FLAG,
  shippedOn: "2026-09-08",
  description:
    "Shares one agent conversation across authorized teammates, with private unread position and drafts for each person.",
  releaseRisk: {
    "risk": "new",
    "reason": "Adds shared agent conversations that authorized teammates can use together."
  },
} as const satisfies FeatureFlagDefinition;
