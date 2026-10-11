import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_6860_MOBILE_PAGE_HIDE_DOCK_FLAG = "htpr-6860-mobile-page-hide-dock";

export default {
  key: HTPR_6860_MOBILE_PAGE_HIDE_DOCK_FLAG,
  shippedOn: "2026-10-03",
  description:
    "On mobile ticket pages (/page/...): hide the bottom bar, the same as the ticket screen.",
  kind: "improvement",
} as const satisfies FeatureFlagDefinition;
