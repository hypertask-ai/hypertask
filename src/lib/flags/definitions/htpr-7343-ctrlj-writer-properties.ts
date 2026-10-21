import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7343_CTRLJ_WRITER_PROPERTIES_FLAG = "htpr-7343-ctrlj-writer-properties";

export default {
  key: HTPR_7343_CTRLJ_WRITER_PROPERTIES_FLAG,
  kind: "bugfix",
  shippedOn: "2026-10-19",
  description: "Ctrl+J tickets keep the priority and size the task writer proposed, and the Proposed properties line no longer stays in the description.",
  releaseRisk: {
    "risk": "small",
    "reason": "Ctrl+J tickets get the writer's proposed priority and size unless the view or the user already set them."
  },
} as const satisfies FeatureFlagDefinition;
