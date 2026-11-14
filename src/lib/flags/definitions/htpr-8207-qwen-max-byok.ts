import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_8207_QWEN_MAX_BYOK_FLAG = "htpr-8207-qwen-max-byok";

export default {
  key: HTPR_8207_QWEN_MAX_BYOK_FLAG,
  defaultMode: "EVERYONE",
  shippedOn: "2026-11-13",
  description:
    "Tests the Alibaba BYOK connection with Qwen3.8 Max instead of the retired Qwen3.7 Plus.",
  releaseRisk: {
    risk: "small",
    reason:
      "Only changes which Alibaba model the settings connection test calls.",
  },
  kind: "improvement",
} as const satisfies FeatureFlagDefinition;
