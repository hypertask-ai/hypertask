import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7792_REPLY_INBOX_FLAG = "htpr-7792-reply-inbox";

export default {
  key: HTPR_7792_REPLY_INBOX_FLAG,
  kind: "bugfix",
  defaultMode: "EVERYONE",
  shippedOn: "2026-10-25",
  description: "Replying on a ticket archives its current Inbox notification even when the ticket was opened from the board before that notification arrived.",
  releaseRisk: {
    risk: "small",
    reason: "Uses the existing viewer-scoped Inbox archive and undo. Next-task navigation and the advance-on-send preference stay unchanged. Off restores the ticket-count check outside Inbox flow.",
  },
} as const satisfies FeatureFlagDefinition;
