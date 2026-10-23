import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7571_INBOX_CTRLK_CLOSE_FLAG = "htpr-7571-inbox-ctrlk-close";

export default {
  key: HTPR_7571_INBOX_CTRLK_CLOSE_FLAG,
  kind: "bugfix",
  defaultMode: "EVERYONE",
  shippedOn: "2026-10-22",
  description: "A second Ctrl/Cmd+K closes the Inbox search palette while its commands are still loading.",
  releaseRisk: {
    risk: "small",
    reason: "Only closes pending Inbox search commands from the existing focus proxy; Off retains the previous shortcut behavior.",
  },
} as const satisfies FeatureFlagDefinition;
