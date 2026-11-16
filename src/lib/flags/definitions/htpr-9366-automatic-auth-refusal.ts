import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_9366_AUTOMATIC_AUTH_REFUSAL_FLAG =
  "htpr-9366-automatic-auth-refusal";

export default {
  key: HTPR_9366_AUTOMATIC_AUTH_REFUSAL_FLAG,
  kind: "bugfix",
  defaultMode: "EVERYONE",
  shippedOn: "2026-11-16",
  description:
    "A refused agent sign-in that Hypertask reports by itself now reads as a key or permission problem, not as a possible Hypertask bug.",
  releaseRisk: {
    risk: "small",
    reason:
      "Only the words on feedback tickets filed automatically, and only when the report is a normal access refusal. The ticket, the tally and the agent log stay the same. Off keeps today's wording.",
  },
} as const satisfies FeatureFlagDefinition;
