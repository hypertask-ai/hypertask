import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7146_AGENT_SCOPE_ENFORCE_FLAG = "htpr-7146-agent-scope-enforce";

export default {
  key: HTPR_7146_AGENT_SCOPE_ENFORCE_FLAG,
  kind: "bugfix",
  shippedOn: "2026-10-16",
  defaultMode: "OFF",
  description: "Off watches agent board access without restricting production access. On requires an Accepted board grant for agent access.",
  releaseRisk: {
    risk: "small",
    reason: "Enforcement removes inherited owner access from agents without Accepted board grants; Off only records ids-only misses.",
  },
} as const satisfies FeatureFlagDefinition;
