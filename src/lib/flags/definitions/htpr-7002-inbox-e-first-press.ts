import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7002_INBOX_E_FIRST_PRESS_FLAG = "htpr-7002-inbox-e-first-press";

export default {
  key: HTPR_7002_INBOX_E_FIRST_PRESS_FLAG,
  shippedOn: "2026-10-07",
  description: "Inbox E archives the open ticket on the first press even before its full notification membership finishes loading.",
  kind: "bugfix",
} as const satisfies FeatureFlagDefinition;
