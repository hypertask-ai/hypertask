import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7070_AGENT_CHAT_OWNER_ONLY_FLAG = "htpr-7070-agent-chat-owner-only";

export default {
  key: HTPR_7070_AGENT_CHAT_OWNER_ONLY_FLAG,
  kind: "feature",
  defaultMode: "OWNER_AND_QA",
  shippedOn: "2026-10-10",
  description: "Restricts Agent Chat pages, entry points and APIs to the owner; turning it off restores the previous access.",
  releaseRisk: {
    "risk": "new",
    "reason": "Agent Chat is hidden for everyone except the owner."
  },
} as const satisfies FeatureFlagDefinition;
