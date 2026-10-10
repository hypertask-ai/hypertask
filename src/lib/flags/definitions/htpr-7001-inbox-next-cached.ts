import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7001_INBOX_NEXT_CACHED_FLAG = "htpr-7001-inbox-next-cached";

export default {
  key: HTPR_7001_INBOX_NEXT_CACHED_FLAG,
  kind: "bugfix",
  shippedOn: "2026-10-07",
  description: "Opens the next or previous Inbox ticket from saved data immediately, then refreshes it from the server.",
} as const satisfies FeatureFlagDefinition;
