import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_6861_MOBILE_PAGE_BACK_ROW_FLAG = "htpr-6861-mobile-page-back-row";

export default {
  key: HTPR_6861_MOBILE_PAGE_BACK_ROW_FLAG,
  shippedOn: "2026-10-03",
  description:
    "On mobile ticket pages: use the Settings-style back row, inset the title, and move page deletion into Commands.",
  kind: "improvement",
} as const satisfies FeatureFlagDefinition;
