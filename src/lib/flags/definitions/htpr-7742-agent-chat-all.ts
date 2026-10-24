import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7742_AGENT_CHAT_ALL_FLAG = "htpr-7742-agent-chat-all";

export default {
  key: HTPR_7742_AGENT_CHAT_ALL_FLAG,
  kind: "improvement",
  defaultMode: "OWNER_AND_QA",
  shippedOn: "2026-10-24",
  description: "Enables polling fallback, MCP chat inbox and reply, and honest agent chat availability.",
  releaseRisk: { risk: "small", highRisk: "access", reason: "Reuses existing agent-token chat authorization and reply routes; flag Off restores existing delivery and status." },
} as const satisfies FeatureFlagDefinition;
