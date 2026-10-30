import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_8219_STATUS_UPDATE_DOOR_FLAG = "htpr-8219-status-update-door";

export default {
  key: HTPR_8219_STATUS_UPDATE_DOOR_FLAG,
  kind: "improvement",
  defaultMode: "EVERYONE",
  shippedOn: "2026-10-30",
  description: "An agent can draft the board status update over MCP from the same numbers the board report shows, and the draft is saved on the board as the status update report.",
  releaseRisk: {
    risk: "small",
    reason: "Same generation and same saved report as the existing status update button on the board report; the agent door only reaches it without a browser. Off removes the action and leaves every other report action as before.",
  },
} as const satisfies FeatureFlagDefinition;
