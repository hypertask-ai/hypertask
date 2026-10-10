import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_6990_NARROW_SIDEBAR_WIDTH_FLAG = "htpr-6990-narrow-sidebar-width";

export default {
  key: HTPR_6990_NARROW_SIDEBAR_WIDTH_FLAG,
  kind: "bugfix",
  shippedOn: "2026-10-07",
  description: "Keeps ticket comments visible in narrow desktop windows by overlaying AI chat when its sidebar would squeeze the page.",
} as const satisfies FeatureFlagDefinition;
