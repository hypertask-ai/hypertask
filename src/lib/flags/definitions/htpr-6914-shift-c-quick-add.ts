import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_6914_SHIFT_C_QUICK_ADD_FLAG = "htpr-6914-shift-c-quick-add";

export default {
  key: HTPR_6914_SHIFT_C_QUICK_ADD_FLAG,
  kind: "feature",
  shippedOn: "2026-10-03",
  description: "Shift+C opens the quick add box like N",
  related: ["htpr-6175-quick-entry-cards"],
} as const satisfies FeatureFlagDefinition;
