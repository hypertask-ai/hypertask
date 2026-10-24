import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7799_PROJECT_ENTRY_FLAG = "htpr-7799-project-entry";

export default {
  key: HTPR_7799_PROJECT_ENTRY_FLAG,
  kind: "bugfix",
  defaultMode: "EVERYONE",
  shippedOn: "2026-10-24",
  description:
    "Validate remembered boards against the current account and board API access rules; show existing recovery states on load failure and make the primary Sign out action clear every browser account.",
  releaseRisk: {
    risk: "small",
    reason: "Only gates board navigation, existing recovery UI and the browser-wide Sign out action; authentication, session revocation, and board permissions are unchanged by this flag.",
  },
} as const satisfies FeatureFlagDefinition;
