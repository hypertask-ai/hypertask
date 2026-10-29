import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7975_COLUMN_WORK_LIMITS_FLAG = "htpr-7975-column-work-limits";

export default {
  key: HTPR_7975_COLUMN_WORK_LIMITS_FLAG,
  kind: "improvement",
  defaultMode: "EVERYONE",
  shippedOn: "2026-10-26",
  description: "Column work limits warn when active tasks exceed a saved limit. Staleness-enabled boards also show fresh card ages. Off hides limits and restores stale-only ages without deleting settings.",
  releaseRisk: {
    risk: "small",
    reason: "Advisory counts and existing board settings only; no task moves are blocked and stored limits survive rollback.",
  },
} as const satisfies FeatureFlagDefinition;
