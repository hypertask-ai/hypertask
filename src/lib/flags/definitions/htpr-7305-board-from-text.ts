import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7305_BOARD_FROM_TEXT_FLAG = "htpr-7305-board-from-text";

export default {
  key: HTPR_7305_BOARD_FROM_TEXT_FLAG,
  kind: "feature",
  defaultMode: "EVERYONE",
  shippedOn: "2026-10-21",
  description: "Ctrl+J New Task selects a board named in the note by title or identifier, using the existing board chip and preserving manual choices.",
  releaseRisk: {
    risk: "small",
    reason: "Only a unique match among the user's existing board choices changes the destination; the existing picker can override it before saving.",
  },
} as const satisfies FeatureFlagDefinition;
