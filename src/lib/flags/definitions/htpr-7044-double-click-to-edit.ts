import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7044_DOUBLE_CLICK_TO_EDIT_FLAG = "htpr-7044-double-click-to-edit";

export default {
  key: HTPR_7044_DOUBLE_CLICK_TO_EDIT_FLAG,
  kind: "bugfix",
  shippedOn: "2026-10-09",
  description: "Keeps hover controls out of comment and description editing, restores deliberate double-click editing, and preserves phone double tap and Edit actions.",
} as const satisfies FeatureFlagDefinition;
