import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_8513_AGENT_MENTIONS_FLAG = "htpr-8513-agent-mentions";

export default {
  key: HTPR_8513_AGENT_MENTIONS_FLAG,
  kind: "bugfix",
  defaultMode: "EVERYONE",
  shippedOn: "2026-11-04",
  description:
    "A mention name resolves to an agent on the board as well as a person. Naming an agent posts the comment, and a wrong name is a caller-fixable refusal instead of a Bugs ticket.",
  releaseRisk: {
    risk: "small",
    reason:
      "Only widens which board member a written name can resolve to. With the switch off an agent name is refused exactly as today, and a person mention notifies the same person as before.",
  },
} as const satisfies FeatureFlagDefinition;
