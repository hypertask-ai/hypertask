import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7659_ARCHIVE_EVERY_SEND_FLAG = "htpr-7659-archive-every-send";

export default {
  key: HTPR_7659_ARCHIVE_EVERY_SEND_FLAG,
  kind: "bugfix",
  defaultMode: "EVERYONE",
  shippedOn: "2026-10-23",
  description: "Every comment sent from an Inbox message archives that message, not only the first two in a row, because the archive looks up the message in the Inbox itself.",
  releaseRisk: {
    risk: "small",
    reason: "Only affects sending from a ticket opened from the Inbox: the message found in the Inbox list is archived with the same archive call as before. Off restores the old check that stopped archiving after two sends.",
  },
} as const satisfies FeatureFlagDefinition;
