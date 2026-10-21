import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7270_SIGNUP_COMPLETED_FLAG = "htpr-7270-signup-completed";

export default {
  key: HTPR_7270_SIGNUP_COMPLETED_FLAG,
  kind: "feature",
  shippedOn: "2026-10-16",
  defaultMode: "OWNER_AND_QA",
  description: "Replaces user_signed_up with a deduplicated server signup_completed event for new accounts.",
  releaseRisk: {
    risk: "new",
    reason: "Changes signup analytics with per-account deduplication and consent-gated attribution.",
  },
} as const satisfies FeatureFlagDefinition;
