import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7799_PROJECT_ENTRY_FLAG = "htpr-7799-project-entry";

export default {
  key: HTPR_7799_PROJECT_ENTRY_FLAG,
  kind: "bugfix",
  defaultMode: "OWNER_AND_QA",
  shippedOn: "2026-10-24",
  description:
    "Validate remembered boards against the current account and board API access rules; show existing recovery states on load failure and make the primary Sign out action clear every browser account.",
  releaseRisk: {
    risk: "small",
    highRisk: "access",
    reason: "Changes which boards the current account can enter through remembered URLs and first-board lookup; also gates browser-wide sign-out and recovery UI.",
  },
} as const satisfies FeatureFlagDefinition;
