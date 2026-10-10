import type { FeatureFlagDefinition } from "../definitions";

export const GOOGLE_CALENDAR_FLAG = "htpr-3533-google-calendar";

export default {
  key: GOOGLE_CALENDAR_FLAG,
  kind: "feature",
  shippedOn: "2026-09-08",
  description:
    "Lets each user connect Google Calendar and keep assigned tasks with due dates in a dedicated Hypertask calendar.",
  releaseRisk: {
    "risk": "new",
    "reason": "Adds Google Calendar connection settings and task synchronization."
  },
} as const satisfies FeatureFlagDefinition;
