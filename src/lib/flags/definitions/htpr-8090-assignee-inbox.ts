import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_8090_ASSIGNEE_INBOX_FLAG = "htpr-8090-assignee-inbox";

export default {
  key: HTPR_8090_ASSIGNEE_INBOX_FLAG,
  kind: "bugfix",
  defaultMode: "EVERYONE",
  shippedOn: "2026-10-27",
  description: "Human assignees receive inbox items for their agents' question, QA and done comments, even with quiet-owner mode on.",
  releaseRisk: {
    risk: "small",
    reason: "Restores inbox delivery only for explicit human assignees and typed comments. Email recipients, untyped chatter and human self-comments stay unchanged.",
  },
} as const satisfies FeatureFlagDefinition;
