import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7342_WEB_WRITING_TASK_WRITER_FLAG = "htpr-7342-web-writing-task-writer";

export default {
  key: HTPR_7342_WEB_WRITING_TASK_WRITER_FLAG,
  kind: "feature",
  shippedOn: "2026-10-19",
  defaultMode: "OWNER_AND_QA",
  description:
    "Task writer (Ctrl+J, CLI and MCP) writes tickets with web-writing, then unslop: each fact once, no Proposed: lines, no questions in the description.",
  releaseRisk: {
    risk: "small",
    reason: "Only changes the writing-style prompt of the task writer; output format and extraction stay the same.",
  },
} as const satisfies FeatureFlagDefinition;
