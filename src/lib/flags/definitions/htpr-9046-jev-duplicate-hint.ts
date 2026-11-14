import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_9046_JEV_DUPLICATE_HINT_FLAG = "htpr-9046-jev-duplicate-hint";

export default {
  key: HTPR_9046_JEV_DUPLICATE_HINT_FLAG,
  kind: "feature",
  defaultMode: "EVERYONE",
  shippedOn: "2026-11-10",
  description: "The Task Writer asks Jev whether each similar ticket is the same work and opens the draft with Looks like HTPR-123 only when Jev is very sure.",
  releaseRisk: {
    risk: "small",
    reason: "One sentence above the draft only when a similar ticket scores 0.9 or higher. Off restores today's writer prompt and spends nothing on Jev.",
  },
} as const satisfies FeatureFlagDefinition;
