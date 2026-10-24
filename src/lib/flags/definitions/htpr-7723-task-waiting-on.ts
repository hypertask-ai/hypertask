import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7723_TASK_WAITING_ON_FLAG = "htpr-7723-task-waiting-on";

export default {
  key: HTPR_7723_TASK_WAITING_ON_FLAG,
  kind: "feature",
  defaultMode: "EVERYONE",
  shippedOn: "2026-10-24",
  description: "Agents can set and clear blocked by person on a ticket through MCP and the CLI.",
  releaseRisk: {
    risk: "small",
    reason: "Adds MCP waiting-on writes using existing board membership checks; disabling it stops agent writes without changing existing app session writes.",
  },
} as const satisfies FeatureFlagDefinition;
