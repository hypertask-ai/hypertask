import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_5906_NO_PHONE_NUDGES_FLAG = "htpr-5906-no-phone-nudges";

export default {
  key: HTPR_5906_NO_PHONE_NUDGES_FLAG,
  kind: "bugfix",
  defaultMode: "EVERYONE",
  shippedOn: "2026-10-24",
  description: "Hides keyboard shortcut nudges on phones and stops phone archives from earning a tip for later on desktop.",
  releaseRisk: {
    risk: "small",
    reason: "Excludes phone viewports from shortcut tips and archive counting. Off preserves phone tips and counting; desktop behavior is unchanged.",
  },
} as const satisfies FeatureFlagDefinition;
