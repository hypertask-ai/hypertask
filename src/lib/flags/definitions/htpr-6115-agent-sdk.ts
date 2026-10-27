import type { FeatureFlagDefinition } from "../definitions";

export const AGENT_RUN_FEATURE_FLAG = "htpr-6115-agent-sdk";

export default {
  key: AGENT_RUN_FEATURE_FLAG,
  shippedOn: "2026-09-04",
  description: "Enables the shared Agent SDK run model and lifecycle endpoints.",
  releaseRisk: {
    "risk": "none",
    "reason": "Adds a shared agent run model and developer endpoints without changing app screens."
  },
  kind: "feature",
} as const satisfies FeatureFlagDefinition;
