import type { FeatureFlagDefinition } from "../definitions";

export const LUNA_FREE_PLAN_FLAG = "htpr-6722-latest-models";

export default {
  key: LUNA_FREE_PLAN_FLAG,
  kind: "improvement",
  shippedOn: "2026-09-30",
  description:
    "Lets Free plans use GPT 6 Luna and makes it their default AI model. Without it Free plans default to Gemini 3.5 Flash Lite.",
} as const satisfies FeatureFlagDefinition;
