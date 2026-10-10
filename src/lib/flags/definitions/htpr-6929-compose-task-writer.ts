import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_6929_COMPOSE_TASK_WRITER_FLAG = "htpr-6929-compose-task-writer";

export default {
  key: HTPR_6929_COMPOSE_TASK_WRITER_FLAG,
  shippedOn: "2026-10-04",
  description: "Adds Ctrl+J Compose to Commands: write a ticket from a note and images, then refine it in task-scoped AI chat.",
  releaseRisk: {
    "risk": "new",
    "reason": "Adds a Compose flow that writes a ticket from notes and images, then opens AI refinement."
  },
} as const satisfies FeatureFlagDefinition;
