import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_6363_TASK_WRITER_RESEARCH_FLAG = "htpr-6363-task-writer-research";

export default {
  key: HTPR_6363_TASK_WRITER_RESEARCH_FLAG,
  shippedOn: "2026-09-11",
  description:
    "Restores board research in the AI task writer: related tickets, Done-style examples, open questions, and refine search from user text.",
  kind: "bugfix",
  defaultMode: "OWNER_AND_QA",
} as const satisfies FeatureFlagDefinition;
