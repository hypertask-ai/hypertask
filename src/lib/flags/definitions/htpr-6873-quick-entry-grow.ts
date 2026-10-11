import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_6873_QUICK_ENTRY_GROW_FLAG = "htpr-6873-quick-entry-grow";

export default {
  key: HTPR_6873_QUICK_ENTRY_GROW_FLAG,
  shippedOn: "2026-10-03",
  description: "Lets the board and table quick-entry box grow to eight lines, then scroll, with Create task and close buttons.",
  kind: "improvement",
  related: ["htpr-6175-quick-entry-cards"],
} as const satisfies FeatureFlagDefinition;
