import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7074_PHONE_WORKSPACE_WIDTH_FLAG = "htpr-7074-phone-workspace-width";

export default {
  key: HTPR_7074_PHONE_WORKSPACE_WIDTH_FLAG,
  kind: "bugfix",
  shippedOn: "2026-10-10",
  description: "Stops a phone's ticket page from starting squeezed to nothing by the space kept for the AI panel, so the title and details no longer jump wider a few seconds after opening.",
  releaseRisk: {
    "risk": "small",
    "reason": "Only changes how much room the page keeps for the AI panel before the app knows it is on a phone; the loaded phone layout is the same."
  },
} as const satisfies FeatureFlagDefinition;
