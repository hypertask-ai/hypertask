import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7339_AGENT_PULSE_DOT_FLAG = "htpr-7339-agent-pulse-dot";

export default {
  key: HTPR_7339_AGENT_PULSE_DOT_FLAG,
  kind: "feature",
  defaultMode: "OWNER_AND_QA",
  shippedOn: "2026-11-10",
  description:
    "A small dot on the agent status chip pulses blue while an agent is working and stays orange while it waits for you.",
  releaseRisk: {
    risk: "small",
    reason:
      "Only the agent chip on board cards and the ticket header gain a 6px status dot. Off hides the dot; the chip text stays as today.",
  },
} as const satisfies FeatureFlagDefinition;
