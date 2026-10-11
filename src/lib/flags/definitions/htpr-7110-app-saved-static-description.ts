import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7110_APP_SAVED_STATIC_DESCRIPTION_FLAG = "htpr-7110-app-saved-static-description";

export default {
  key: HTPR_7110_APP_SAVED_STATIC_DESCRIPTION_FLAG,
  kind: "bugfix",
  shippedOn: "2026-10-11",
  description: "Descriptions written in the app also show as soon as a ticket loads, before the editor arrives, like descriptions written by agents already do.",
  related: ["htpr-7091-static-description-first"],
  releaseRisk: {
    "risk": "small",
    "reason": "The description looks the same; only the editor behind it arrives a moment later."
  },
} as const satisfies FeatureFlagDefinition;
