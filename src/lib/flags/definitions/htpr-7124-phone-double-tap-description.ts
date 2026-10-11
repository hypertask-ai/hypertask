import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7124_PHONE_DOUBLE_TAP_DESCRIPTION_FLAG = "htpr-7124-phone-double-tap-description";

export default {
  key: HTPR_7124_PHONE_DOUBLE_TAP_DESCRIPTION_FLAG,
  kind: "bugfix",
  shippedOn: "2026-10-11",
  releaseRisk: {
    "risk": "small",
    "reason": "On phones, taps on a read-only ticket description now reach its double-tap check; editing mode and comments are unchanged.",
  },
  description: "On phones, a double tap on the text of a ticket description opens the editor, not only a double tap on its padding.",
} as const satisfies FeatureFlagDefinition;
