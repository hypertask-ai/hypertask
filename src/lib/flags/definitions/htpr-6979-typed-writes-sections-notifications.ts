import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_6979_TYPED_WRITES_FLAG = "htpr-6979-typed-writes-sections-notifications";

export default {
  key: HTPR_6979_TYPED_WRITES_FLAG,
  kind: "feature",
  shippedOn: "2026-10-06",
  description: "Validates section and notification writes with shared typed API contracts.",
} as const satisfies FeatureFlagDefinition;
