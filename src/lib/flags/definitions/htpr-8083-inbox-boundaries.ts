import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_8083_INBOX_BOUNDARIES_FLAG = "htpr-8083-inbox-boundaries";

export default {
  key: HTPR_8083_INBOX_BOUNDARIES_FLAG,
  kind: "bugfix",
  defaultMode: "EVERYONE",
  shippedOn: "2026-10-27",
  description: "Inbox gg and Shift+gg jump to the first and last displayed rows, including blocked tickets.",
  releaseRisk: {
    risk: "small",
    reason: "Uses the existing rendered keyboard row order for boundary jumps. Off restores raw notification order.",
  },
} as const satisfies FeatureFlagDefinition;
