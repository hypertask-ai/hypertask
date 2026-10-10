import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7064_INBOX_REMIND_RETURNS_FLAG = "htpr-7064-inbox-remind-returns";

export default {
  key: HTPR_7064_INBOX_REMIND_RETURNS_FLAG,
  kind: "bugfix",
  shippedOn: "2026-10-10",
  description: "Clears the Inbox archive timestamp when a reminder returns an existing notification so the ticket is visible again.",
} as const satisfies FeatureFlagDefinition;
