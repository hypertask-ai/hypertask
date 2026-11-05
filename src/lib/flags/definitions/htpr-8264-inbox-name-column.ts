import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_8264_INBOX_NAME_COLUMN_FLAG = "htpr-8264-inbox-name-column";

export default {
  key: HTPR_8264_INBOX_NAME_COLUMN_FLAG,
  kind: "improvement",
  defaultMode: "OWNER_AND_QA",
  shippedOn: "2026-11-05",
  description:
    "Inbox rows give the sender a fixed 180px column and the ticket number a fixed 72px slot, so every ticket number and title starts on one even line.",
  releaseRisk: {
    risk: "small",
    reason:
      "Only fixes two widths in the desktop inbox row. Content, order, actions, archive and mobile stay the same, and Off restores today's packed row.",
  },
} as const satisfies FeatureFlagDefinition;
