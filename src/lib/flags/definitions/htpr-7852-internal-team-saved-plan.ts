import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7852_INTERNAL_TEAM_SAVED_PLAN_FLAG = "htpr-7852-internal-team-saved-plan";

export default {
  key: HTPR_7852_INTERNAL_TEAM_SAVED_PLAN_FLAG,
  kind: "improvement",
  defaultMode: "OFF",
  shippedOn: "2026-10-30",
  releaseRisk: {
    risk: "small",
    highRisk: "access",
    reason: "Our own team stops being forced to Pro and uses its saved plan for AI access and board admission; if the saved plan is not Pro, the team loses paid access.",
  },
  description: "Our own internal team resolves its plan from its saved subscription or comp instead of a hardcoded Pro.",
} as const satisfies FeatureFlagDefinition;
