import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_8909_ABANDONED_WORK_FLAG = "htpr-8909-abandoned-work";

export default {
  key: HTPR_8909_ABANDONED_WORK_FLAG,
  kind: "improvement",
  defaultMode: "EVERYONE",
  shippedOn: "2026-11-07",
  releaseRisk: {
    risk: "new",
    reason: "Quiet abandoned claims return to intake every thirty minutes. Active runners, human assignees, and fresh open changes stay. Switching the flag off stops the sweep.",
  },
  description: "Return abandoned In Progress work on the product and infra boards without interrupting active runners.",
} as const satisfies FeatureFlagDefinition;
