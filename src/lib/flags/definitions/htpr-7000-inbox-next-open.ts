import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7000_INBOX_NEXT_OPEN_FLAG = "htpr-7000-inbox-next-open";

export default {
  key: HTPR_7000_INBOX_NEXT_OPEN_FLAG,
  kind: "bugfix",
  shippedOn: "2026-10-07",
  description: "Shows the ticket opened by Inbox J or the next arrow instead of leaving the previous cached ticket over the new route.",
} as const satisfies FeatureFlagDefinition;
