import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7269_SIGNUP_IDENTITY_LINK_FLAG = "htpr-7269-signup-identity-link";

export default {
  key: HTPR_7269_SIGNUP_IDENTITY_LINK_FLAG,
  kind: "feature",
  shippedOn: "2026-10-16",
  defaultMode: "OWNER_AND_QA",
  description: "Links anonymous website visits to newly created accounts with consent-aware signup attribution.",
  releaseRisk: {
    risk: "new",
    reason: "Joins analytics identities at signup; single-use context and anonymous-only checks prevent account merges.",
  },
} as const satisfies FeatureFlagDefinition;
