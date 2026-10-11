import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7061_REMIND_WITHOUT_INBOX_FLAG = "htpr-7061-remind-without-inbox";

export default {
  key: HTPR_7061_REMIND_WITHOUT_INBOX_FLAG,
  kind: "bugfix",
  shippedOn: "2026-10-10",
  description: "Creates a ticket reminder in the Inbox at delivery time when the user has no notification to restore.",
  releaseRisk: {
    "risk": "small",
    "reason": "The existing Remind action brings a ticket back to the Inbox even when it had no Inbox item."
  },
} as const satisfies FeatureFlagDefinition;
