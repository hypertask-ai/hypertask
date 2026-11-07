import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7577_ADD_EXISTING_AGENT_FLAG = "htpr-7577-add-existing-agent";

export default {
  key: HTPR_7577_ADD_EXISTING_AGENT_FLAG,
  kind: "feature",
  defaultMode: "OWNER_AND_QA",
  shippedOn: "2026-10-22",
  description: "Board settings lets people add agents they own using a searchable picker.",
  releaseRisk: {
    risk: "small",
    highRisk: "access",
    reason: "Uses the existing add-agent rule and route unchanged; Off hides the button.",
  },
} as const satisfies FeatureFlagDefinition;
