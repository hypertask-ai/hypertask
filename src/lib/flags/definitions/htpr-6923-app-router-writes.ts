import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_6923_APP_ROUTER_WRITES_FLAG = "htpr-6923-app-router-writes";

export default {
  key: HTPR_6923_APP_ROUTER_WRITES_FLAG,
  kind: "feature",
  shippedOn: "2026-10-06",
  description: "Uses shared App-style handlers for legacy task writes while keeping the original URLs and responses.",
} as const satisfies FeatureFlagDefinition;
