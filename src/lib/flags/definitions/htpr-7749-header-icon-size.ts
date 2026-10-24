import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7749_HEADER_ICON_SIZE_FLAG = "htpr-7749-header-icon-size";

export default {
  key: HTPR_7749_HEADER_ICON_SIZE_FLAG,
  kind: "bugfix",
  defaultMode: "EVERYONE",
  shippedOn: "2026-10-24",
  description: "The ticket header's archive, done, reminder, and command icons use the same 16px toolbar size.",
  releaseRisk: {
    risk: "small",
    reason: "Changes only ticket-header icon sizing and stroke consistency. Off restores the original icon sizes and strokes.",
  },
} as const satisfies FeatureFlagDefinition;
