import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7273_COLUMN_EVENTS_FLAG = "htpr-7273-column-events";

export default {
  key: HTPR_7273_COLUMN_EVENTS_FLAG,
  kind: "feature",
  shippedOn: "2026-10-16",
  defaultMode: "OWNER_AND_QA",
  description: "Sends column_created and column_renamed to PostHog from the server after each saved column or rename, marking default and starter columns.",
  releaseRisk: {
    "risk": "none",
    "reason": "Server-side analytics only; nothing users see changes."
  },
} as const satisfies FeatureFlagDefinition;
