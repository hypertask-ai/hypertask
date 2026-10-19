import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7363_CHAT_TASK_WRITER_FLAG = "htpr-7363-chat-task-writer";

export default {
  key: HTPR_7363_CHAT_TASK_WRITER_FLAG,
  kind: "feature",
  shippedOn: "2026-10-20",
  defaultMode: "OWNER_AND_QA",
  description:
    "Sidebar chat creates tasks through the CLI and Ctrl+J task writer, including the HTPR-7342 authoring style, priority and size.",
  releaseRisk: {
    risk: "new",
    reason: "Adds task-writer inference before chat task creation; writer failures refuse the write rather than saving chat-authored text.",
  },
} as const satisfies FeatureFlagDefinition;
