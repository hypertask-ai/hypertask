import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_8048_AGENT_SESSIONS_FLAG = "htpr-8048-agent-sessions";

export default {
  key: HTPR_8048_AGENT_SESSIONS_FLAG,
  kind: "feature",
  defaultMode: "EVERYONE",
  shippedOn: "2026-10-26",
  description: "Choose agents and their separate conversations from the chat header or an @ mention.",
  releaseRisk: {
    risk: "new",
    reason: "Reuses board-scoped agent authorization and preserves each agent's default conversation. Off restores the existing picker.",
  },
} as const satisfies FeatureFlagDefinition;
