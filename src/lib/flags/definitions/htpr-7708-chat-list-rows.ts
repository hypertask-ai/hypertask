import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7708_CHAT_LIST_ROWS_FLAG = "htpr-7708-chat-list-rows";

export default {
  key: HTPR_7708_CHAT_LIST_ROWS_FLAG,
  kind: "bugfix",
  defaultMode: "EVERYONE",
  shippedOn: "2026-10-24",
  description: "Keeps sidebar conversation names within auto-height rows, wrapping long tokens and showing at most two lines.",
  releaseRisk: {
    risk: "small",
    reason: "Only changes existing inline sidebar rows. Off restores fixed desktop row height and unclamped names; command palette rows stay unchanged.",
  },
} as const satisfies FeatureFlagDefinition;
