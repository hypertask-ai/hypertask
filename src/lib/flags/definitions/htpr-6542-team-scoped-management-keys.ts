import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_6542_TEAM_SCOPED_MANAGEMENT_KEYS_FLAG = "htpr-6542-team-scoped-management-keys";

export default {
  key: HTPR_6542_TEAM_SCOPED_MANAGEMENT_KEYS_FLAG,
  kind: "feature",
  shippedOn: "2026-09-18",
  description:
    "Lets management keys be limited to one team while existing account-wide keys keep their current access.",
  releaseRisk: {
    "risk": "new",
    "reason": "Management key settings add a choice to limit a key to one team."
  },
} as const satisfies FeatureFlagDefinition;
