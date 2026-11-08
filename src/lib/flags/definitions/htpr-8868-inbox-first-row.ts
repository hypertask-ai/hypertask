import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_8868_INBOX_FIRST_ROW_FLAG = "htpr-8868-inbox-first-row";

export default {
  key: HTPR_8868_INBOX_FIRST_ROW_FLAG,
  kind: "bugfix",
  defaultMode: "EVERYONE",
  shippedOn: "2026-11-08",
  description: "The Inbox opens at its first row and the first J, K or arrow press focuses that row instead of stepping past it.",
  releaseRisk: {
    risk: "small",
    reason: "Row actions and mouse focus stay as they are. Off restores the old first-press step.",
  },
} as const satisfies FeatureFlagDefinition;
