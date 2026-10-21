import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7271_SAVED_WORK_EVENTS_FLAG = "htpr-7271-saved-work-events";

export default {
  key: HTPR_7271_SAVED_WORK_EVENTS_FLAG,
  kind: "feature",
  shippedOn: "2026-10-16",
  defaultMode: "OWNER_AND_QA",
  description: "Sends board_created and task_created to PostHog from the server after each saved board or task, with board, workspace and seeded properties.",
  releaseRisk: {
    "risk": "none",
    "reason": "Server-side analytics only; nothing users see changes."
  },
} as const satisfies FeatureFlagDefinition;
