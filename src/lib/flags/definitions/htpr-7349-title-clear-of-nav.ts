import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7349_TITLE_CLEAR_OF_NAV_FLAG = "htpr-7349-title-clear-of-nav";

export default {
  key: HTPR_7349_TITLE_CLEAR_OF_NAV_FLAG,
  kind: "bugfix",
  shippedOn: "2026-10-19",
  description: "Keeps the start of a ticket's title visible in narrow desktop windows, where the back and up/down buttons used to cover its first letters.",
  releaseRisk: {
    "risk": "small",
    "reason": "Only changes the title's left padding on the desktop ticket page when the ticket column is under 640px wide; wider windows, phones and embedded tickets keep today's layout."
  },
} as const satisfies FeatureFlagDefinition;
