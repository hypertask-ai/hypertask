import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7308_PHONE_LAYOUT_WIDTH_FLAG = "htpr-7308-phone-layout-width";

export default {
  key: HTPR_7308_PHONE_LAYOUT_WIDTH_FLAG,
  kind: "bugfix",
  defaultMode: "EVERYONE",
  shippedOn: "2026-10-18",
  description:
    "Decides phone or desktop layout from the same screen width the page styles use, so a zoomed-out phone page no longer opens the desktop AI chat over an open task.",
  releaseRisk: {
    risk: "small",
    reason: "Only phones whose page could zoom out past 768px change: they now get the phone layout instead of the desktop chat sidebar.",
  },
} as const satisfies FeatureFlagDefinition;
