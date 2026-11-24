import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_9621_AUTO_SWITCH_ACCOUNT_FLAG = "htpr-9621-auto-switch-account";

export default {
  key: HTPR_9621_AUTO_SWITCH_ACCOUNT_FLAG,
  kind: "feature",
  defaultMode: "OWNER_AND_QA",
  shippedOn: "2026-11-23",
  description: "On the unavailable ticket page, switch to the one other signed-in account that can open it.",
  releaseRisk: {
    risk: "new",
    highRisk: "access",
    reason: "Checks each signed-in account on this device before switching sessions, and stays at Owner and QA so a bad check can be turned off.",
    harmEvidence: {
      harm: "private-data-exposure",
      scenario: "A signed-in account that cannot open a ticket could be shown that ticket, or learn that it exists, if another account on the same browser were treated as proof of access.",
    },
  },
} as const satisfies FeatureFlagDefinition;
