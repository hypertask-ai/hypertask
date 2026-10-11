import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7122_AGENT_REACTIONS_FLAG = "htpr-7122-agent-reactions";

export default {
  key: HTPR_7122_AGENT_REACTIONS_FLAG,
  kind: "feature",
  defaultMode: "OWNER_AND_QA",
  shippedOn: "2026-10-11",
  description:
    "Tells connected agents to react to a person's comment with an emoji instead of posting an acknowledgement comment, to use all of Hypertask's abilities, and that an agent's reaction never counts as an approval.",
  releaseRisk: {
    "risk": "small",
    "reason": "Only the guidance agents read from hello changes; nothing people see in the app changes, and with the flag off agents get today's text."
  },
} as const satisfies FeatureFlagDefinition;
