import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_6924_REST_COMPAT_FLAG = "htpr-6924-rest-compat";

export default {
  key: HTPR_6924_REST_COMPAT_FLAG,
  shippedOn: "2026-10-06",
  description: "Uses shared authentication and input readers for page REST routes while preserving legacy responses. Later compatibility migrations use the same switch.",
  kind: "feature",
} as const satisfies FeatureFlagDefinition;
