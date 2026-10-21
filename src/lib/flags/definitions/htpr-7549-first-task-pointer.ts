import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7549_FIRST_TASK_POINTER_FLAG = "htpr-7549-first-task-pointer";

export default {
  key: HTPR_7549_FIRST_TASK_POINTER_FLAG,
  kind: "feature",
  defaultMode: "OWNER_ONLY",
  shippedOn: "2026-10-21",
  releaseRisk: {
    risk: "new",
    reason: "Adds a first-task compose pointer and updates the seeded board's AI connection instructions; no signup, access, billing or email changes.",
  },
  description: "Points new seeded-board owners to the first-task writer and refreshes AI connection instructions. Owner-only preview requested by Valentin on 2026-10-21.",
} as const satisfies FeatureFlagDefinition;
