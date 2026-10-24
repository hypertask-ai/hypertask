import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7754_DEEPSEEK_AUTH_REFUSAL_FLAG = "htpr-7754-deepseek-auth-refusal";

export default {
  key: HTPR_7754_DEEPSEEK_AUTH_REFUSAL_FLAG,
  kind: "bugfix",
  shippedOn: "2026-10-24",
  defaultMode: "EVERYONE",
  description:
    "Explains rejected direct DeepSeek AI keys with a Settings > AI keys recovery message and logs them as warnings instead of incidents.",
  releaseRisk: {
    risk: "small",
    reason: "Changes only the message and logging for rejected direct DeepSeek BYOK credentials; routing and access are unchanged.",
  },
} as const satisfies FeatureFlagDefinition;
