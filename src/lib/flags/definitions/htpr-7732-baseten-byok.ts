import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7732_BASETEN_BYOK_FLAG = "htpr-7732-baseten-byok";

export default {
  key: HTPR_7732_BASETEN_BYOK_FLAG,
  kind: "feature",
  shippedOn: "2026-10-24",
  defaultMode: "EVERYONE",
  description:
    "Adds a team Baseten API key for the four supported model options. Off hides the row and stops Baseten routing and key tests.",
  releaseRisk: {
    risk: "new",
    reason: "Only teams that save a Baseten key are routed to Baseten; native and customer gateway keys keep precedence and existing funding order is unchanged.",
  },
} as const satisfies FeatureFlagDefinition;
