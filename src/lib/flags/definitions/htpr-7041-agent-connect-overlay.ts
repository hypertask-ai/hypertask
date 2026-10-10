import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7041_AGENT_CONNECT_OVERLAY_FLAG = "htpr-7041-agent-connect-overlay";

export default {
  key: HTPR_7041_AGENT_CONNECT_OVERLAY_FLAG,
  kind: "feature",
  defaultMode: "OWNER_AND_QA",
  shippedOn: "2026-10-10",
  description: "Opens the MCP Token dialog for new users with a live connection line, instead of the Connect your agent block above the board.",
  releaseRisk: {
    "risk": "small",
    "reason": "Only first-time users who never connected an agent see the dialog, and closing it once stops it for good."
  },
} as const satisfies FeatureFlagDefinition;
