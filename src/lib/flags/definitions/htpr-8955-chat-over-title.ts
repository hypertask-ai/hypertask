import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_8955_CHAT_OVER_TITLE_FLAG = "htpr-8955-chat-over-title";

export default {
  key: HTPR_8955_CHAT_OVER_TITLE_FLAG,
  kind: "bugfix",
  defaultMode: "EVERYONE",
  shippedOn: "2026-11-09",
  description:
    "The ticket title row no longer draws over the AI chat sidebar. With the chat open, the chat header and the whole chat stay fully visible and on top of the ticket.",
  releaseRisk: {
    risk: "small",
    reason:
      "Only lowers the stacking layer of the ticket title row so the chat sits above it. Nothing is added or moved, and Off restores the old layer.",
  },
} as const satisfies FeatureFlagDefinition;
