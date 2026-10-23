import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7518_AGENT_SIDEBAR_CHATS_FLAG = "htpr-7518-agent-sidebar-chats";

export default {
  key: HTPR_7518_AGENT_SIDEBAR_CHATS_FLAG,
  kind: "feature",
  shippedOn: "2026-10-21",
  defaultMode: "OWNER_AND_QA",
  description: "Switch between AI chat and accepted board agents in the existing sidebar.",
  releaseRisk: {
    risk: "new",
    highRisk: "access",
    reason: "Exposes agent conversations in the sidebar and binds terminal sessions to their recipients",
  },
} as const satisfies FeatureFlagDefinition;
