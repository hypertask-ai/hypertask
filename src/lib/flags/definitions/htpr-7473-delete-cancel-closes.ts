import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7473_DELETE_CANCEL_CLOSES_FLAG = "htpr-7473-delete-cancel-closes";

export default {
  key: HTPR_7473_DELETE_CANCEL_CLOSES_FLAG,
  kind: "bugfix",
  shippedOn: "2026-10-20",
  description: "Cancel in the delete task confirmation on a ticket page closes the dialog and keeps the ticket open.",
  releaseRisk: {
    risk: "small",
    reason: "Cancel only closes the existing dialog instead of staying open or going back in history; confirming a delete is unchanged.",
  },
} as const satisfies FeatureFlagDefinition;
