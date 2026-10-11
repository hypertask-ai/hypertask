import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_6966_SKILLS_ACCESS_DENIAL_FLAG = "htpr-6966-skills-access-denial";

export default {
  key: HTPR_6966_SKILLS_ACCESS_DENIAL_FLAG,
  shippedOn: "2026-10-06",
  description: "Returns missing or inaccessible skills projects as 404 without filing production error tickets.",
  kind: "bugfix",
} as const satisfies FeatureFlagDefinition;
