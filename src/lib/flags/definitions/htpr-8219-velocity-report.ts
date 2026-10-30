import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_8219_VELOCITY_REPORT_FLAG = "htpr-8219-velocity-report";

export default {
  key: HTPR_8219_VELOCITY_REPORT_FLAG,
  kind: "improvement",
  defaultMode: "EVERYONE",
  shippedOn: "2026-10-30",
  description: "An agent can read the board speed report as numbers over MCP, the same numbers the board report screen shows.",
  releaseRisk: {
    risk: "small",
    reason: "Read-only door on the existing report tool; it returns the same numbers the web report shows. Off removes the action and leaves every other report action as before.",
  },
} as const satisfies FeatureFlagDefinition;
