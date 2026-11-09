import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7915_AUTO_MODEL_FLAG = "htpr-7915-auto-model";

export default {
  key: HTPR_7915_AUTO_MODEL_FLAG,
  kind: "improvement",
  defaultMode: "OWNER_AND_QA",
  shippedOn: "2026-11-09",
  description: "Adds Auto to the AI chat model picker as the default and routes every AI feature to a cheaper or stronger model by job, inside the models the team has enabled. Off keeps today's fixed defaults.",
} as const satisfies FeatureFlagDefinition;
