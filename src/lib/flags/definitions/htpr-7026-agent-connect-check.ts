import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7026_AGENT_CONNECT_CHECK_FLAG = "htpr-7026-agent-connect-check";

export default {
  key: HTPR_7026_AGENT_CONNECT_CHECK_FLAG,
  kind: "feature",
  defaultMode: "OWNER_AND_QA",
  shippedOn: "2026-10-08",
  description: "Shows first-time agent setup and a live connection check on your landing board, then sends one connected email.",
} as const satisfies FeatureFlagDefinition;
