import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7601_ONLY_VIEWED_TICKET_QUESTIONS_FLAG = "htpr-7601-only-viewed-ticket-questions";

export default {
  key: HTPR_7601_ONLY_VIEWED_TICKET_QUESTIONS_FLAG,
  kind: "bugfix",
  defaultMode: "EVERYONE",
  shippedOn: "2026-10-22",
  description: "Asks for new-ticket questions only when the chat session belongs to the ticket in view, so Ctrl+J no longer requests questions for the previous Ctrl+J ticket.",
  related: ["htpr-7317-ctrlj-ticket-questions", "htpr-7586-one-questions-call"],
  releaseRisk: {
    risk: "small",
    reason: "Skips only the new-ticket questions request and chips while the chat briefly shows another ticket's session. Off restores today's request.",
  },
} as const satisfies FeatureFlagDefinition;
