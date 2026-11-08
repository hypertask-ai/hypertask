import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_8889_PEOPLE_COMMENT_WRITING_FLAG = "htpr-8889-people-comment-writing";

export default {
  key: HTPR_8889_PEOPLE_COMMENT_WRITING_FLAG,
  kind: "bugfix",
  defaultMode: "EVERYONE",
  shippedOn: "2026-11-07",
  description: "A people comment edit is refused when any line breaks the writing rules, and an agent run reply on a ticket is checked the same way. Off leaves stored lines alone on edit and leaves run replies unchecked.",
  releaseRisk: {
    risk: "small",
    reason: "Only refuses an agent comment edit or ticket reply that already breaks the writing rules. A short edit, a human edit, and a task description edit stay as they are. Off keeps today's edit and today's run replies.",
  },
} as const satisfies FeatureFlagDefinition;
