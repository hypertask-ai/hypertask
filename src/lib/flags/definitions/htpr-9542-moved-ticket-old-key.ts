import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_9542_MOVED_TICKET_OLD_KEY_FLAG = "htpr-9542-moved-ticket-old-key";

export default {
  key: HTPR_9542_MOVED_TICKET_OLD_KEY_FLAG,
  kind: "bugfix",
  defaultMode: "EVERYONE",
  shippedOn: "2026-11-22",
  description:
    "A ticket moved to another board names the old keys that still open it. Off leaves the new key with no previous keys.",
  releaseRisk: {
    risk: "small",
    reason:
      "Adds previousTicketNumbers on task reads and board moves when an old key still resolves. Off omits the field.",
  },
} as const satisfies FeatureFlagDefinition;
