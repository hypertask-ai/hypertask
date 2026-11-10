import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_9025_AI_BOX_OUTLINE_FLAG = "htpr-9025-ai-box-outline";

export default {
  key: HTPR_9025_AI_BOX_OUTLINE_FLAG,
  kind: "improvement",
  defaultMode: "OWNER_AND_QA",
  shippedOn: "2026-11-10",
  description: "Gives the Write with AI box in the description and comment editors a 1px outline in the editor border colour.",
  releaseRisk: {
    risk: "small",
    reason: "Only adds a border to an existing box. Behaviour, size and corners stay the same, and Off restores the borderless box.",
  },
} as const satisfies FeatureFlagDefinition;
