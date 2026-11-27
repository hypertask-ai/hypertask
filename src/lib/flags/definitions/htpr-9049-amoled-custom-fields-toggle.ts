import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_9049_AMOLED_CUSTOM_FIELDS_TOGGLE_FLAG = "htpr-9049-amoled-custom-fields-toggle";

export default {
  key: HTPR_9049_AMOLED_CUSTOM_FIELDS_TOGGLE_FLAG,
  kind: "bugfix",
  defaultMode: "OWNER_AND_QA",
  shippedOn: "2026-11-24",
  description: "In the AMOLED theme the Rail and Table switches in Manage custom fields use the theme's neutral grey on-state instead of green, matching Settings.",
  related: ["htpr-9027-amoled-toggle"],
  releaseRisk: {
    risk: "small",
    reason: "Only the on-state colour of two existing switches changes, and only in AMOLED. Other themes, the off state and the saved values stay the same.",
  },
} as const satisfies FeatureFlagDefinition;
