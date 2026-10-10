import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7032_EMAIL_EXPIRY_COPY_FLAG = "htpr-7032-email-expiry-copy";

export default {
  key: HTPR_7032_EMAIL_EXPIRY_COPY_FLAG,
  kind: "bugfix",
  shippedOn: "2026-10-09",
  description: "Shows sign-in link and code expiry times from their actual TTLs instead of swapping them.",
} as const satisfies FeatureFlagDefinition;
