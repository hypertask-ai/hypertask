import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7397_CALENDAR_LOADING_SHELL_FLAG = "htpr-7397-calendar-loading-shell";

export default {
  key: HTPR_7397_CALENDAR_LOADING_SHELL_FLAG,
  kind: "bugfix",
  shippedOn: "2026-10-20",
  description: "While the Calendar loads, the left app rail stays on screen instead of the whole page turning into a bare Loading... text.",
  releaseRisk: {
    risk: "small",
    reason: "Only changes what shows for a moment while the Calendar page mounts; the calendar itself is unchanged.",
  },
} as const satisfies FeatureFlagDefinition;
