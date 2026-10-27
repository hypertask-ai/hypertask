import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_5908_RETYPE_LOWERCASE_FLAG = "htpr-5908-retype-lowercase";

export default {
  key: HTPR_5908_RETYPE_LOWERCASE_FLAG,
  shippedOn: "2026-10-26",
  description: "Keeps intentional lowercase when you delete and retype an automatically capitalized word, and underlines the whole corrected word.",
  kind: "bugfix",
  defaultMode: "EVERYONE",
  related: ["htpr-5908-local-writing-assistance", "htpr-6906-autocap-undo"],
  releaseRisk: {
    risk: "small",
    reason: "Only changes retyping and correction hints in editors with local capitalization already enabled.",
  },
} as const satisfies FeatureFlagDefinition;
