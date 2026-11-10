import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_9002_CTRL_J_NEW_TASK_FLAG = "htpr-9002-ctrl-j-new-task";

export default {
  key: HTPR_9002_CTRL_J_NEW_TASK_FLAG,
  kind: "feature",
  shippedOn: "2026-11-10",
  defaultMode: "OWNER_AND_QA",
  description:
    "Ctrl+J (Cmd+J on Mac) on the new task screen opens the Write with AI box inside the description instead of saving the ticket and opening AI chat. With an empty description the box writes the whole task, title and description, from a short prompt, with the board's task templates as chips. Off keeps today's Ctrl+J.",
  releaseRisk: {
    risk: "small",
    reason:
      "Changes one shortcut on the new task screen and adds a write mode to the Write with AI box. The box never saves the task. Flag Off restores today's Ctrl+J and description placeholder.",
  },
} as const satisfies FeatureFlagDefinition;
