import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7895_TASK_NUMBER_ALIAS_FLAG = "htpr-7895-task-number-alias";

export default {
  key: HTPR_7895_TASK_NUMBER_ALIAS_FLAG,
  kind: "bugfix",
  defaultMode: "EVERYONE",
  shippedOn: "2026-10-25",
  description: "Lets MCP tool calls pass task_number as an accepted alias for ticket_number instead of failing on an unsupported field.",
  releaseRisk: { risk: "small", reason: "Input compatibility only; flag Off restores the previous refusal and every ticket_number call is unchanged." },
} as const satisfies FeatureFlagDefinition;
