import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7685_CHAT_FOLLOWS_BOARD_FLAG = "htpr-7685-chat-follows-board";

export default {
  key: HTPR_7685_CHAT_FOLLOWS_BOARD_FLAG,
  kind: "bugfix",
  defaultMode: "EVERYONE",
  shippedOn: "2026-10-23",
  description: "The docked AI chat opens on the board you are viewing; a board picked in the chat applies only on the board where it was picked.",
  releaseRisk: {
    risk: "small",
    reason: "Changes only which board the docked AI chat picker shows. Off keeps the saved picker board on every page.",
  },
} as const satisfies FeatureFlagDefinition;
