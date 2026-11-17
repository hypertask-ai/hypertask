import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_9071_INBOX_ZERO_TABS_FLAG = "htpr-9071-inbox-zero-tabs";

export default {
  key: HTPR_9071_INBOX_ZERO_TABS_FLAG,
  kind: "bugfix",
  defaultMode: "EVERYONE",
  shippedOn: "2026-11-17",
  description:
    "Inbox zero shows only the reward image. The split tab bar is no longer drawn above it when the open split is empty. Off brings back the tab bar on the empty inbox.",
  releaseRisk: {
    risk: "small",
    reason:
      "Visible inbox change that removes a layout bug on the empty inbox. Off restores today's tab bar above the image.",
  },
} as const satisfies FeatureFlagDefinition;
