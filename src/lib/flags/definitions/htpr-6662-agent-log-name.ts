import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_6662_AGENT_LOG_NAME_FLAG = "htpr-6662-agent-log-name";

export default {
  key: HTPR_6662_AGENT_LOG_NAME_FLAG,
  shippedOn: "2026-10-03",
  description: "Names the task history toggle Show agent log or Hide agent log in Ctrl+K and Toggle agent log in shortcut help.",
  kind: "improvement",
} as const satisfies FeatureFlagDefinition;
