import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_6902_N_QUICK_ADD_FLAG = "htpr-6902-n-quick-add";

export default {
  key: HTPR_6902_N_QUICK_ADD_FLAG,
  shippedOn: "2026-10-03",
  description: "N opens the existing quick-entry box in the focused board or table column when quick-entry cards are enabled. C keeps opening the full editor.",
  related: ["htpr-6175-quick-entry-cards"],
} as const satisfies FeatureFlagDefinition;
