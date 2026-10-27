import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7970_BULK_BLOCKED_INBOX_FLAG = "htpr-7970-bulk-blocked-inbox";

export default {
  key: HTPR_7970_BULK_BLOCKED_INBOX_FLAG,
  kind: "bugfix",
  shippedOn: "2026-10-26",
  defaultMode: "EVERYONE",
  description: "Lets bulk archive dismiss Blocked by you Inbox rows without clearing their blockers. Undo restores them. Off keeps blocked rows out of bulk selection.",
  releaseRisk: {
    risk: "small",
    reason: "Reuses the existing single-row Inbox dismissal and undo; task status and blockers stay unchanged.",
  },
} as const satisfies FeatureFlagDefinition;
