import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_9054_REMOVE_AGENT_CHIP_FLAG = "htpr-9054-remove-agent-chip-under-title";

export default {
  key: HTPR_9054_REMOVE_AGENT_CHIP_FLAG,
  kind: "bugfix",
  defaultMode: "OWNER_AND_QA",
  shippedOn: "2026-11-11",
  description:
    "The ticket header no longer shows the agent status chip under the title on desktop or phone. The board card chip and its pulse dot stay.",
  releaseRisk: {
    risk: "small",
    reason:
      "Removes one chip from the ticket header. Off keeps the header chip exactly as today; the board card chip is untouched either way.",
  },
} as const satisfies FeatureFlagDefinition;
