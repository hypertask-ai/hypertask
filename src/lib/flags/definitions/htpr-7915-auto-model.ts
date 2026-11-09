import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7915_AUTO_MODEL_FLAG = "htpr-7915-auto-model";

export default {
  key: HTPR_7915_AUTO_MODEL_FLAG,
  kind: "improvement",
  defaultMode: "OWNER_AND_QA",
  shippedOn: "2026-11-09",
  description: "Makes Auto the default AI model and routes each AI feature by job inside the team's enabled models.",
  releaseRisk: { risk: "small", reason: "Picks among models the team already enabled; Owner and QA first because the picker changes." },
} as const satisfies FeatureFlagDefinition;
