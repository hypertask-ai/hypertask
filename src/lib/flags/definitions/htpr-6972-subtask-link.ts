import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_6972_SUBTASK_LINK_FLAG = "htpr-6972-subtask-link";

export default {
  key: HTPR_6972_SUBTASK_LINK_FLAG,
  kind: "bugfix",
  shippedOn: "2026-10-06",
  description: "Shows the linked task instead of keeping the parent's cached detail when navigating between tasks, including subtasks and parent links.",
} as const satisfies FeatureFlagDefinition;
