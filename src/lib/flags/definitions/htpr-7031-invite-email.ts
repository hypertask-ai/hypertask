import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7031_INVITE_EMAIL_FLAG = "htpr-7031-invite-email";

export default {
  key: HTPR_7031_INVITE_EMAIL_FLAG,
  kind: "bugfix",
  shippedOn: "2026-10-09",
  description: "Fixes invite sender names, explains the shared human and AI agent board, and encodes invite link parameters.",
} as const satisfies FeatureFlagDefinition;
