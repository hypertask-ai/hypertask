import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_9045_JEV_INBOX_TRIAGE_FLAG = "htpr-9045-jev-inbox-triage";

export default {
  key: HTPR_9045_JEV_INBOX_TRIAGE_FLAG,
  kind: "feature",
  defaultMode: "OWNER_AND_QA",
  shippedOn: "2026-11-10",
  description: "Inbox Zero asks Jev which notifications need you, suggests archiving only the ones it calls noise at 0.9 or higher, and still waits for one confirmation.",
  releaseRisk: {
    risk: "new",
    reason: "A wrong Jev answer could suggest archiving a question. The code keeps questions, mentions, money and access items out of the suggestion, the person confirms before anything moves, and Off removes the row.",
  },
} as const satisfies FeatureFlagDefinition;
