import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_9009_WRITER_URGENCY_FLAG = "htpr-9009-writer-urgency";

export default {
  key: HTPR_9009_WRITER_URGENCY_FLAG,
  kind: "feature",
  defaultMode: "EVERYONE",
  shippedOn: "2026-11-10",
  description: "Task Writer proposes priority Urgent when the note has an urgency word such as urgent, asap, today, right now, immediately, blocker or production down.",
  releaseRisk: {
    risk: "small",
    reason: "Only changes the proposed priority of new Task Writer tickets when the note itself says it is urgent. Off keeps today's priority behavior.",
  },
} as const satisfies FeatureFlagDefinition;
