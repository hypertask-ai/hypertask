import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_9546_SHARE_FOOTER_LAYOUT_FLAG = "htpr-9546-share-footer-layout";

export default {
  key: HTPR_9546_SHARE_FOOTER_LAYOUT_FLAG,
  kind: "bugfix",
  defaultMode: "EVERYONE",
  shippedOn: "2026-11-24",
  description:
    "A shared ticket's invite bar stacks the sentence above the sign-in control on a phone, so the two no longer fold into each other or cover the last comment. Off keeps the single-row bar.",
  releaseRisk: {
    risk: "small",
    reason:
      "Changes only the layout of the existing guest invite bar on a phone. The bar keeps one sign-in control and the same share route, and the switch off brings the single row back.",
  },
} as const satisfies FeatureFlagDefinition;
