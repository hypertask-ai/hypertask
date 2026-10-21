import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7293_ACTIVATION_METRIC_V1_FLAG = "htpr-7293-activation-metric-v1";

export default {
  key: HTPR_7293_ACTIVATION_METRIC_V1_FLAG,
  kind: "feature",
  shippedOn: "2026-10-17",
  defaultMode: "OWNER_AND_QA",
  description: "Versions activation_completed as board_3_tasks_7d_v1 using owned non-seeded board and task creation facts within seven days of signup.",
  releaseRisk: {
    risk: "new",
    reason: "Changes activation eligibility and business time, counting later archived or soft-deleted work without recounting users already activated.",
  },
} as const satisfies FeatureFlagDefinition;
