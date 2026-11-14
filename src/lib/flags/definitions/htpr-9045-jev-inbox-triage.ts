import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_9045_JEV_INBOX_TRIAGE_FLAG = "htpr-9045-jev-inbox-triage";

export default {
  key: HTPR_9045_JEV_INBOX_TRIAGE_FLAG,
  kind: "feature",
  defaultMode: "OWNER_AND_QA",
  shippedOn: "2026-11-10",
  description: "Inbox Zero asks a decision model which notifications need you and only suggests archiving noise at 0.9 or higher. One confirmation still archives.",
  releaseRisk: {
    risk: "new",
    reason: "A wrong answer could suggest archiving a question. Code keeps questions, mentions, money and access items out, the person confirms, and Off removes the suggestion.",
  },
} as const satisfies FeatureFlagDefinition;
