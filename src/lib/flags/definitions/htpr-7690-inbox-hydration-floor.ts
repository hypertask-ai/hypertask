import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7690_INBOX_HYDRATION_FLOOR_FLAG = "htpr-7690-inbox-hydration-floor";

export default {
  key: HTPR_7690_INBOX_HYDRATION_FLOOR_FLAG,
  kind: "bugfix",
  shippedOn: "2026-10-23",
  defaultMode: "EVERYONE",
  description: "On keeps an Inbox message you just archived from coming back when you open or reload the Inbox right away. Off restores the old check, which could show the saved list from before the archive.",
  releaseRisk: {
    risk: "small",
    reason: "Only decides whether the saved browser copy of the Inbox may show before the fresh list; when in doubt it waits for the fresh list.",
  },
} as const satisfies FeatureFlagDefinition;
