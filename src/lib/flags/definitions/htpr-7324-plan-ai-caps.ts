import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7324_PLAN_AI_CAPS_FLAG = "htpr-7324-plan-ai-caps";

export default {
  key: HTPR_7324_PLAN_AI_CAPS_FLAG,
  kind: "feature",
  shippedOn: "2026-10-20",
  description:
    "Caps included AI across foreground and background work at $5 per paid seat monthly, or $1 monthly and $0.25 daily for Free teams. BYOK never falls back to Hypertask-funded keys.",
  releaseRisk: {
    risk: "new",
    reason:
      "High risk: changes spending authorization, paid seat allowances and BYOK fallback behavior across every platform-funded AI call.",
  },
} as const satisfies FeatureFlagDefinition;
