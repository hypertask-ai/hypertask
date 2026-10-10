import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_6975_TYPED_WRITES_FLAG = "htpr-6975-typed-writes";

export default {
  key: HTPR_6975_TYPED_WRITES_FLAG,
  shippedOn: "2026-10-06",
  description: "Validates ticket property writes with shared typed API contracts.",
} as const satisfies FeatureFlagDefinition;
