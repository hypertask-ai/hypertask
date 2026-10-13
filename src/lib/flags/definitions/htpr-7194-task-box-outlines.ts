import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7194_TASK_BOX_OUTLINES_FLAG = "htpr-7194-task-box-outlines";

export default {
  key: HTPR_7194_TASK_BOX_OUTLINES_FLAG,
  kind: "bugfix",
  shippedOn: "2026-10-13",
  description: "Gives task descriptions, posted comments, the comment composer and details panel one matching outline with an active focus colour.",
  releaseRisk: {
    risk: "small",
    reason: "Changes only task detail box outlines and corners, preserving composer geometry.",
  },
} as const satisfies FeatureFlagDefinition;
