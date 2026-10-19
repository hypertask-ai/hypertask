import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7389_FLAG_RELEASE_POLICY_FLAG = "htpr-7389-flag-release-policy";

export default {
  key: HTPR_7389_FLAG_RELEASE_POLICY_FLAG,
  kind: "improvement",
  defaultMode: "EVERYONE",
  shippedOn: "2026-10-20",
  description: "Hides internal-only flags from the flags page and lets the one-hour release watch switch a just-released flag Off when production errors spike.",
  releaseRisk: {
    "risk": "none",
    "reason": "Only the flags admin page and automatic flag switches change; app users see nothing."
  },
} as const satisfies FeatureFlagDefinition;
