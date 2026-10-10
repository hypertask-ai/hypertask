import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_6175_QUICK_ENTRY_CARDS_FLAG = "htpr-6175-quick-entry-cards";

export default {
  key: HTPR_6175_QUICK_ENTRY_CARDS_FLAG,
  shippedOn: "2026-09-07",
  description: "Opens a small inline box for the column plus and the table's New task button so several cards can be entered one after another without the full editor.",
} as const satisfies FeatureFlagDefinition;
