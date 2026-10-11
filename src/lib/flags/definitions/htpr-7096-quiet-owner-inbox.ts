import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7096_QUIET_OWNER_INBOX_FLAG = "htpr-7096-quiet-owner-inbox";

export default {
  key: HTPR_7096_QUIET_OWNER_INBOX_FLAG,
  kind: "improvement",
  defaultMode: "OWNER_AND_QA",
  shippedOn: "2026-10-10",
  description:
    "Your inbox only gets your agents' comments when they mention you, an agent mention is Important only when it is a Question, and a Question you answered leaves Important.",
  releaseRisk: {
    "risk": "small",
    "reason": "Only which agent comments reach the owner's inbox and which rows count as Important changes; human comments, mentions and agent inboxes stay the same."
  },
} as const satisfies FeatureFlagDefinition;
