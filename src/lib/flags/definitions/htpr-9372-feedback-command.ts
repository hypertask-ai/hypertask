import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_9372_FEEDBACK_COMMAND_FLAG = "htpr-9372-feedback-command";

export default {
  key: HTPR_9372_FEEDBACK_COMMAND_FLAG,
  kind: "bugfix",
  defaultMode: "EVERYONE",
  shippedOn: "2026-11-16",
  description:
    "A feedback ticket keeps the command name in the title and the problem line when that name is one long word.",
  releaseRisk: {
    risk: "small",
    reason:
      "Only the words on a new feedback ticket change. Off keeps today's shorter title, which can drop the command.",
  },
} as const satisfies FeatureFlagDefinition;
