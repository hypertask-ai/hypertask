import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_9685_ANTHROPIC_CREDIT_FIRST_FLAG =
  "htpr-9685-anthropic-credit-first";

export default {
  key: HTPR_9685_ANTHROPIC_CREDIT_FIRST_FLAG,
  kind: "improvement",
  defaultMode: "EVERYONE",
  shippedOn: "2026-11-25",
  description:
    "Routes Hypertask-paid Claude AI calls to the direct Anthropic monthly credit first, with automatic Vercel AI Gateway fallback and daily urgent alerts.",
  releaseRisk: {
    risk: "small",
    reason:
      "Uses existing Claude models via direct Anthropic credit before falling back automatically to the Vercel AI Gateway; non-visual and fast-revertable.",
  },
} as const satisfies FeatureFlagDefinition;
