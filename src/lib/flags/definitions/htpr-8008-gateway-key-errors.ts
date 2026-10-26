import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_8008_GATEWAY_KEY_ERRORS_FLAG = "htpr-8008-gateway-key-errors";

export default {
  key: HTPR_8008_GATEWAY_KEY_ERRORS_FLAG,
  kind: "bugfix",
  defaultMode: "EVERYONE",
  shippedOn: "2026-10-26",
  description: "AI usage explains rejected customer Gateway keys and missing report permissions.",
  releaseRisk: {
    risk: "small",
    reason: "Only usage error messages change. No key, funding, billing, allowance or access changes.",
  },
} as const satisfies FeatureFlagDefinition;
