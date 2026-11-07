import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_8758_WORKFLOW_MAPPING_FLAG = "htpr-8758-workflow-mapping";

export default {
  key: HTPR_8758_WORKFLOW_MAPPING_FLAG,
  kind: "bugfix",
  defaultMode: "OWNER_AND_QA",
  description:
    "Agent move refusals and missing columns include allowed workflow mapping with semantic roles.",
  releaseRisk: {
    risk: "small",
    reason: "Adds role on section reads and clarifies existing move refusals without changing successful moves.",
  },
} as const satisfies FeatureFlagDefinition;
