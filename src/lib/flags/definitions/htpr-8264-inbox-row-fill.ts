import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_8264_INBOX_ROW_FILL_FLAG = "htpr-8264-inbox-row-fill";

export default {
  key: HTPR_8264_INBOX_ROW_FILL_FLAG,
  kind: "improvement",
  defaultMode: "EVERYONE",
  shippedOn: "2026-11-03",
  description:
    "Inbox rows pack sender, ticket number and title to the left and the preview text fills the row up to the tags, with the reason, latest human comment and description joined by a dot.",
  releaseRisk: {
    risk: "small",
    reason:
      "Drops the fixed sender and title column widths and chooses the preview text a different way. Row order, actions, archive, splits and every other surface stay the same, and Off restores today's columns.",
  },
} as const satisfies FeatureFlagDefinition;
