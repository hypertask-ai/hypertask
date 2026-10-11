import type { FeatureFlagDefinition } from "../definitions";

export const AGENT_RUN_ACTIVITY_FEATURE_FLAG = "htpr-6122-agent-run-activities";

export default {
  key: AGENT_RUN_ACTIVITY_FEATURE_FLAG,
  shippedOn: "2026-09-04",
  description: "Enables typed thought, action, response, error, and question updates for agent runs.",
  releaseRisk: {
    "risk": "none",
    "reason": "Adds structured agent run updates for integrations without a new app control."
  },
  kind: "feature",
} as const satisfies FeatureFlagDefinition;
