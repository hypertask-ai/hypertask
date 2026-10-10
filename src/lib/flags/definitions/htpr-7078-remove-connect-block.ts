import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7078_REMOVE_CONNECT_BLOCK_FLAG = "htpr-7078-remove-connect-block";

export default {
  key: HTPR_7078_REMOVE_CONNECT_BLOCK_FLAG,
  kind: "bugfix",
  defaultMode: "EVERYONE",
  shippedOn: "2026-10-10",
  description:
    "Removes the Connect your agent block above the board columns, on the board and on the logged-out demo board.",
  releaseRisk: {
    "risk": "small",
    "reason": "The Connect your agent block above the board columns no longer shows; the board columns themselves and the connect-agent onboarding screen are unchanged."
  },
} as const satisfies FeatureFlagDefinition;
