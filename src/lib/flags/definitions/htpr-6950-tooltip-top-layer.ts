import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_6950_TOOLTIP_TOP_LAYER_FLAG = "htpr-6950-tooltip-top-layer";

export default {
  key: HTPR_6950_TOOLTIP_TOP_LAYER_FLAG,
  shippedOn: "2026-10-05",
  description: "Keeps hover tooltips above other interface layers without being clipped or covered.",
  releaseRisk: {
    "risk": "small",
    "reason": "Existing hover tips stay visible above other parts of the interface."
  },
  kind: "feature",
} as const satisfies FeatureFlagDefinition;
