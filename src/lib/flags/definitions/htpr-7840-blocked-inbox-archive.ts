import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7840_BLOCKED_INBOX_ARCHIVE_FLAG = "htpr-7840-blocked-inbox-archive";

export default {
  key: HTPR_7840_BLOCKED_INBOX_ARCHIVE_FLAG,
  kind: "bugfix",
  shippedOn: "2026-10-24",
  defaultMode: "EVERYONE",
  description: "On lets E archive Inbox tickets blocked by you, including in an open ticket, without clearing the blocker. Archived blocked rows stay out after reload. Off restores non-archivable blocked rows.",
  releaseRisk: {
    risk: "small",
    reason: "Only Inbox dismissal changes; task status, blocker metadata and visible ticket ordering stay unchanged.",
  },
} as const satisfies FeatureFlagDefinition;
