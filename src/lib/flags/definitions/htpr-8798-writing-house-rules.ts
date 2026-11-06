import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_8798_WRITING_HOUSE_RULES_FLAG = "htpr-8798-writing-house-rules";

export default {
  key: HTPR_8798_WRITING_HOUSE_RULES_FLAG,
  kind: "improvement",
  defaultMode: "EVERYONE",
  shippedOn: "2026-11-06",
  description: "The writing check refuses a dashed code name, a plain quote of Valentin, a Question in the wrong shape, and a new ticket missing Problem, Fix, Done when, Risk, or Decision.",
  releaseRisk: {
    risk: "small",
    reason: "Only agent writes are checked. Human writes and already stored text stay unchanged.",
  },
} as const satisfies FeatureFlagDefinition;
