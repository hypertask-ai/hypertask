import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_8100_NO_PAID_FALLBACK_FLAG = "htpr-8100-no-paid-fallback";

export default {
  key: HTPR_8100_NO_PAID_FALLBACK_FLAG,
  kind: "bugfix",
  defaultMode: "EVERYONE",
  shippedOn: "2026-11-03",
  description:
    "A failed Haiku answer stays an error instead of quietly switching to a non-Anthropic model that our own Vercel AI Gateway key pays for. A team that brings its own key keeps the fallback. Off restores the older switch.",
  related: ["htpr-7075-background-claude"],
  releaseRisk: {
    "risk": "small",
    "reason": "When Haiku fails, a team without its own key now sees the error instead of a paid Luna answer."
  },
} as const satisfies FeatureFlagDefinition;
