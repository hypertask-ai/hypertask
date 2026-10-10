import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_6567_COMMAND_SCOPE_PICKER_FLAG = "htpr-6567-command-scope-picker";

export default {
  key: HTPR_6567_COMMAND_SCOPE_PICKER_FLAG,
  kind: "feature",
  shippedOn: "2026-10-03",
  description: "My Tasks Scope uses the Ctrl+K assignee picker for boards; Columns and Show done move to Filters.",
} as const satisfies FeatureFlagDefinition;
