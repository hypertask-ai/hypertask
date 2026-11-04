import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_8625_BOARD_INBOX_ARCHIVE_FLAG = "htpr-8625-board-inbox-archive";

export default {
  key: HTPR_8625_BOARD_INBOX_ARCHIVE_FLAG,
  kind: "bugfix",
  defaultMode: "EVERYONE",
  shippedOn: "2026-11-04",
  description: "Allow E to archive inbox notifications from board cards and table rows.",
  releaseRisk: {
    risk: "small",
    reason: "Restores the existing archive shortcut for tasks with inbox notifications; Off preserves the previous behavior.",
  },
} as const satisfies FeatureFlagDefinition;
