import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_8993_PROPERTIES_COLUMN_FLAG = "htpr-8993-properties-column";

export default {
  key: HTPR_8993_PROPERTIES_COLUMN_FLAG,
  kind: "bugfix",
  defaultMode: "EVERYONE",
  shippedOn: "2026-11-16",
  description:
    "The ticket properties box uses 4px corners instead of 5px, its field labels use 4px chips, and a custom field opened from Add field hides again when it is cancelled empty.",
  related: ["htpr-8991-right-column", "htpr-7194-task-box-outlines"],
  releaseRisk: {
    risk: "small",
    reason:
      "Changes only the ticket properties box corners, its label chips, and the empty custom-field row after a cancel. Off keeps the 5px corners and the stuck empty row.",
  },
} as const satisfies FeatureFlagDefinition;
