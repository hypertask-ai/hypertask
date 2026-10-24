import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7755_BULK_PREVIEW_CONFIRMATION_FLAG = "htpr-7755-bulk-preview-confirmation";

export default {
  key: HTPR_7755_BULK_PREVIEW_CONFIRMATION_FLAG,
  kind: "bugfix",
  defaultMode: "OWNER_AND_QA",
  shippedOn: "2026-10-24",
  description: "One confirmation runs all previewed bulk task batches, including assignments and comments, without an unchanged re-preview demanding another yes.",
  releaseRisk: {
    risk: "small",
    highRisk: "data-deletion",
    reason: "Changes the confirmation boundary for bulk status writes, including deletion. Task scope, operation changes, expiry and single-use confirmation remain enforced.",
  },
} as const satisfies FeatureFlagDefinition;
