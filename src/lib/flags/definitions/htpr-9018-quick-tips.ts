import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_9018_QUICK_TIPS_FLAG = "htpr-9018-quick-tips";

export default {
  key: HTPR_9018_QUICK_TIPS_FLAG,
  kind: "improvement",
  defaultMode: "OWNER_AND_QA",
  shippedOn: "2026-11-25",
  description:
    "The quick tips bar on a board has six tips, thin 1px rules between them, the command menu keycaps, 4px corners and an All shortcuts link at the end.",
  releaseRisk: {
    risk: "small",
    reason:
      "Visual tidy of the tips bar only. Every shortcut keeps its behaviour, and Off shows today's bar unchanged.",
  },
} as const satisfies FeatureFlagDefinition;
