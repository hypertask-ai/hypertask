import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7009_DEDUPE_TASK_DETAIL_READS_FLAG = "htpr-7009-dedupe-task-detail-reads";

export default {
  key: HTPR_7009_DEDUPE_TASK_DETAIL_READS_FLAG,
  kind: "bugfix",
  shippedOn: "2026-10-08",
  description: "Loads each ticket detail snapshot once when opening it, while keeping realtime and reconnect refreshes.",
} as const satisfies FeatureFlagDefinition;
