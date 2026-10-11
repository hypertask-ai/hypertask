import type { FeatureFlagDefinition } from "../definitions";

export const PAGE_MENTIONS_FLAG = "htpr-5898-page-mentions";

export default {
  key: PAGE_MENTIONS_FLAG,
  shippedOn: "2026-09-06",
  description:
    "Offers the board's canvas pages in the @ menu, so a comment or description can link a page like it links a task.",
  kind: "feature",
} as const satisfies FeatureFlagDefinition;
