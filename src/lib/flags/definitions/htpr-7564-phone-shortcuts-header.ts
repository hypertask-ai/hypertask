import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7564_PHONE_SHORTCUTS_HEADER_FLAG = "htpr-7564-phone-shortcuts-header";

export default {
  key: HTPR_7564_PHONE_SHORTCUTS_HEADER_FLAG,
  kind: "bugfix",
  defaultMode: "EVERYONE",
  shippedOn: "2026-10-22",
  description: "Keep the keyboard shortcuts Search and Close controls above the app header on phones.",
  releaseRisk: {
    risk: "small",
    reason: "Only raises the phone shortcuts backdrop to the existing sheet layer; Off preserves the previous stacking and desktop is unchanged.",
  },
} as const satisfies FeatureFlagDefinition;
