import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7949_MANAGED_AI_KEY_PROVISIONING_FLAG =
  "htpr-7949-managed-ai-key-provisioning";

export default {
  key: HTPR_7949_MANAGED_AI_KEY_PROVISIONING_FLAG,
  kind: "bugfix",
  defaultMode: "OWNER_AND_QA",
  shippedOn: "2026-10-25",
  description: "Creates missing dedicated managed AI keys when Pro or AI seat plans start or renew, with an operator backfill for existing teams.",
  releaseRisk: {
    risk: "new",
    highRisk: "money",
    reason: "Creates platform-funded AI credentials for paid teams; keep provisioning limited to Owner + QA until billing review and live verification.",
  },
} as const satisfies FeatureFlagDefinition;
