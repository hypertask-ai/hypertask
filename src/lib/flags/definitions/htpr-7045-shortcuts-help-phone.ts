import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7045_SHORTCUTS_HELP_PHONE_FLAG = "htpr-7045-shortcuts-help-phone";

export default {
  key: HTPR_7045_SHORTCUTS_HELP_PHONE_FLAG,
  kind: "bugfix",
  shippedOn: "2026-10-10",
  description: "Uses the full phone width for keyboard shortcuts help, with readable labels and key badges that wrap without shrinking or overflowing.",
} as const satisfies FeatureFlagDefinition;
