import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_8957_CALM_MODEL_PICKER_FLAG = "htpr-8957-calm-model-picker";

export default {
  key: HTPR_8957_CALM_MODEL_PICKER_FLAG,
  kind: "improvement",
  defaultMode: "OWNER_AND_QA",
  shippedOn: "2026-11-15",
  description:
    "The AI chat model menu is one flat list. Auto sits on top, each model shows its provider and price, and effort is a row at the bottom. Off keeps the nested menu.",
  releaseRisk: {
    risk: "small",
    reason:
      "Visible AI chat menu under design review. Off restores the nested model menu, provider headers, and reset row. Saved model choices stay the same.",
  },
} as const satisfies FeatureFlagDefinition;
