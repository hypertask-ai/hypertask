import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7124_PHONE_DOUBLE_TAP_DESCRIPTION_FLAG = "htpr-7124-phone-double-tap-description";

export default {
  key: HTPR_7124_PHONE_DOUBLE_TAP_DESCRIPTION_FLAG,
  kind: "bugfix",
  shippedOn: "2026-10-11",
  description: "On phones, a double tap on the text of a ticket description opens the editor, not only a double tap on its padding.",
} as const satisfies FeatureFlagDefinition;
