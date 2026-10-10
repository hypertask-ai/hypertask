import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_6967_TYPED_TASK_READS_FLAG = "htpr-6967-typed-task-reads";

export default {
  key: HTPR_6967_TYPED_TASK_READS_FLAG,
  kind: "feature",
  shippedOn: "2026-10-06",
  description: "Validates board, description history and cycle reads with shared typed API contracts.",
} as const satisfies FeatureFlagDefinition;
