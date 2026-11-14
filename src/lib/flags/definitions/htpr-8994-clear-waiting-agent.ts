import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_8994_CLEAR_WAITING_AGENT_FLAG = "htpr-8994-clear-waiting-agent";

export default {
  key: HTPR_8994_CLEAR_WAITING_AGENT_FLAG,
  kind: "bugfix",
  defaultMode: "EVERYONE",
  shippedOn: "2026-11-10",
  description:
    "The X on Waiting on removes an agent immediately, for any board member. Off leaves the agent name on the ticket after the clear succeeds.",
  releaseRisk: {
    risk: "small",
    reason: "The clear already saves. This only drops the leftover agent name on the ticket. Off keeps that leftover name.",
  },
} as const satisfies FeatureFlagDefinition;
