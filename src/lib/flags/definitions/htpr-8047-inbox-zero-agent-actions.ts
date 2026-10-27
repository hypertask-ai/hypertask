import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_8047_INBOX_ZERO_AGENT_ACTIONS_FLAG = "htpr-8047-inbox-zero-agent-actions";

export default {
  key: HTPR_8047_INBOX_ZERO_AGENT_ACTIONS_FLAG,
  kind: "bugfix",
  defaultMode: "EVERYONE",
  shippedOn: "2026-10-26",
  description: "Inbox Zero's your own actions category counts only what a person did, so agent questions sent under their account stay in the inbox.",
  releaseRisk: {
    risk: "small",
    reason: "Archives fewer items than before and only agent-authored ones; real own actions still clear and Inbox Zero undo restores archived items.",
  },
} as const satisfies FeatureFlagDefinition;
