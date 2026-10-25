import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7953_INBOX_BULK_ARCHIVE_FLAG = "htpr-7953-inbox-bulk-archive";

export default {
  key: HTPR_7953_INBOX_BULK_ARCHIVE_FLAG,
  kind: "bugfix",
  shippedOn: "2026-10-25",
  defaultMode: "EVERYONE",
  description: "Archive large inbox selections without timing out, keeping archive undo available.",
  releaseRisk: {
    risk: "small",
    reason: "Replaces per-notification writes with two user-scoped updates in the existing transaction; archived notifications remain recoverable.",
  },
} as const satisfies FeatureFlagDefinition;
