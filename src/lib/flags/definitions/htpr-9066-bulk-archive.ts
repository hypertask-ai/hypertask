import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_9066_BULK_ARCHIVE_FLAG = "htpr-9066-bulk-archive";

export default {
  key: HTPR_9066_BULK_ARCHIVE_FLAG,
  kind: "bugfix",
  defaultMode: "OWNER_AND_QA",
  shippedOn: "2026-11-11",
  description: "Save selected board archives together and keep pending cards hidden during refreshes.",
  releaseRisk: { risk: "small", reason: "Reversible archive; existing single-card archive and Undo remain unchanged." },
} as const satisfies FeatureFlagDefinition;
