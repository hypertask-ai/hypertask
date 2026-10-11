import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7060_TASK_WRITER_EMPTY_AND_RESEARCH_FLAG = "htpr-7060-task-writer-empty-and-research";

export default {
  key: HTPR_7060_TASK_WRITER_EMPTY_AND_RESEARCH_FLAG,
  kind: "bugfix",
  shippedOn: "2026-10-10",
  description:
    "Rejects empty task-writer drafts and writes research requests as tickets describing the investigation, not findings.",
  releaseRisk: {
    "risk": "small",
    "reason": "Empty task drafts show a retry error, and research requests describe the investigation instead of presenting findings."
  },
} as const satisfies FeatureFlagDefinition;
