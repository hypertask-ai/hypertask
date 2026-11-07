import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7582_AGENT_ACCESS_REQUEST_FLAG = "htpr-7582-agent-access-request";

export default {
  key: HTPR_7582_AGENT_ACCESS_REQUEST_FLAG,
  kind: "feature",
  defaultMode: "OWNER_AND_QA",
  shippedOn: "2026-10-24",
  description: "Agents can ask their human owner for board access in Inbox Decisions.",
  releaseRisk: {
    risk: "small",
    highRisk: "access",
    reason: "Human owner approval adds agent board membership; off blocks requests and decisions, not prior grants.",
  },
} as const satisfies FeatureFlagDefinition;
