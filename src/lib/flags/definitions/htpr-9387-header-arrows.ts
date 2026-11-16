import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_9387_HEADER_ARROWS_FLAG = "htpr-9387-header-arrows";

export default {
  key: HTPR_9387_HEADER_ARROWS_FLAG,
  kind: "bugfix",
  defaultMode: "EVERYONE",
  shippedOn: "2026-11-16",
  description:
    "Up and down arrows on a ticket sit in the header as plain chevrons beside the other actions, instead of a round pill that covers the header line.",
  releaseRisk: {
    risk: "small",
    reason:
      "Moves the ticket arrows into the header and drops the floating pill. Off puts the pill back on the left.",
  },
} as const satisfies FeatureFlagDefinition;
