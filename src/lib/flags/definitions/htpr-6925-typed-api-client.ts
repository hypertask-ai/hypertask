import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_6925_TYPED_API_CLIENT_FLAG = "htpr-6925-typed-api-client";

export default {
  key: HTPR_6925_TYPED_API_CLIENT_FLAG,
  shippedOn: "2026-10-06",
  description: "Validates skills and board memory settings reads with shared typed API contracts.",
  kind: "feature",
} as const satisfies FeatureFlagDefinition;
