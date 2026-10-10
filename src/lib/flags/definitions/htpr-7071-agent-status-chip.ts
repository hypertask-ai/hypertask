import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7071_AGENT_STATUS_CHIP_FLAG = "htpr-7071-agent-status-chip";

export default {
  key: HTPR_7071_AGENT_STATUS_CHIP_FLAG,
  kind: "feature",
  shippedOn: "2026-10-10",
  description: "Shows a small chip on board cards with the agent working on the ticket, its current step and how long ago it last reported.",
} as const satisfies FeatureFlagDefinition;
