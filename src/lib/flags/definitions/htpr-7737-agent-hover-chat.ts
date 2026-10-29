import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7737_AGENT_HOVER_CHAT_FLAG = "htpr-7737-agent-hover-chat";

export default {
  key: HTPR_7737_AGENT_HOVER_CHAT_FLAG,
  kind: "improvement",
  defaultMode: "EVERYONE",
  shippedOn: "2026-10-28",
  description: "Open an agent's existing sidebar chat from its person hovercard, keeping the current ticket open.",
  releaseRisk: {
    risk: "small",
    reason: "Adds a shortcut to existing board-authorized agent chats. Off removes the hover action and leaves profile navigation unchanged.",
  },
} as const satisfies FeatureFlagDefinition;
