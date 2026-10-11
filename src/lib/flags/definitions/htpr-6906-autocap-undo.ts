import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_6906_AUTOCAP_UNDO_FLAG = "htpr-6906-autocap-undo";

export default {
  key: HTPR_6906_AUTOCAP_UNDO_FLAG,
  shippedOn: "2026-10-11",
  description:
    "Backspace or Ctrl+Z right after an auto-capital keeps your lowercase letter, and the changed letter is briefly underlined.",
  related: ["htpr-5908-local-writing-assistance"],
  releaseRisk: {
    "risk": "small",
    "reason": "Only the key right after an automatic capital letter changes, and only for people who have auto-capitalize."
  },
  kind: "feature",
} as const satisfies FeatureFlagDefinition;
