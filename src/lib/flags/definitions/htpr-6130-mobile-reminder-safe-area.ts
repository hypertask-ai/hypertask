import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_6130_MOBILE_REMINDER_SAFE_AREA_FLAG = "htpr-6130-mobile-reminder-safe-area";

export default {
  key: HTPR_6130_MOBILE_REMINDER_SAFE_AREA_FLAG,
  kind: "feature",
  shippedOn: "2026-09-04",
  description: "Keeps the mobile reminder time selector aligned and clear of bottom controls.",
} as const satisfies FeatureFlagDefinition;
