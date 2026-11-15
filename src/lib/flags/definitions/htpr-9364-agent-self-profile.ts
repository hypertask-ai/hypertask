import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_9364_AGENT_SELF_PROFILE_FLAG = "htpr-9364-agent-self-profile";

export default {
  key: HTPR_9364_AGENT_SELF_PROFILE_FLAG,
  kind: "feature",
  defaultMode: "EVERYONE",
  shippedOn: "2026-11-15",
  description:
    "An agent key can set that same agent's display name and picture. The board already shows those fields. Off keeps the old refusal.",
  releaseRisk: {
    risk: "small",
    reason:
      "Adds a self-only write for an agent's own name and picture. Off restores the refusal. An agent still cannot change another agent, and human rename is unchanged.",
  },
} as const satisfies FeatureFlagDefinition;
