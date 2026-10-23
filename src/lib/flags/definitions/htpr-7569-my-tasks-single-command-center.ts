import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7569_MY_TASKS_SINGLE_COMMAND_CENTER_FLAG = "htpr-7569-my-tasks-single-command-center";

export default {
  key: HTPR_7569_MY_TASKS_SINGLE_COMMAND_CENTER_FLAG,
  kind: "bugfix",
  defaultMode: "EVERYONE",
  shippedOn: "2026-10-22",
  description: "My Tasks uses its table command center without also opening the global command center.",
  releaseRisk: {
    risk: "small",
    reason: "Only suppresses the duplicate global host on My Tasks, preserving table task context and other routes. Off restores the existing hosts.",
  },
} as const satisfies FeatureFlagDefinition;
