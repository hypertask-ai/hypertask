import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7781_SKILL_VALIDATION_FLAG = "htpr-7781-skill-validation";

export default {
  key: HTPR_7781_SKILL_VALIDATION_FLAG,
  kind: "bugfix",
  defaultMode: "EVERYONE",
  shippedOn: "2026-10-24",
  description:
    "Return skill input validation errors without reporting them as server failures. Off restores validation error reporting.",
  releaseRisk: {
    risk: "small",
    reason: "Keeps existing validation and 400 responses; only expected input errors skip server error reporting.",
  },
} as const satisfies FeatureFlagDefinition;
