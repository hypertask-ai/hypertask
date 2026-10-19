import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7379_INBOX_ACTIONS_NO_OUTLINE_FLAG = "htpr-7379-inbox-actions-no-outline";

export default {
  key: HTPR_7379_INBOX_ACTIONS_NO_OUTLINE_FLAG,
  kind: "bugfix",
  shippedOn: "2026-10-19",
  description: "On phone, the Snooze and Remove notification buttons above the comment field no longer get an outline when the ticket description is selected.",
  releaseRisk: {
    risk: "small",
    reason: "Removes one style class from the inbox action row; its size and buttons stay the same.",
  },
} as const satisfies FeatureFlagDefinition;
