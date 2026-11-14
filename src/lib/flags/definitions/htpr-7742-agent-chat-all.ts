import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7742_AGENT_CHAT_ALL_FLAG = "htpr-7742-agent-chat-all";

export default {
  key: HTPR_7742_AGENT_CHAT_ALL_FLAG,
  kind: "improvement",
  defaultMode: "OWNER_AND_QA",
  shippedOn: "2026-11-11",
  description: "Lets every agent read sidebar chat on the next run, and shows Online or Reads when it next runs.",
  releaseRisk: { risk: "small", reason: "Reuses the existing agent-token chat routes. Off restores the previous status sentence and leaves offline messages delivered." },
} as const satisfies FeatureFlagDefinition;
