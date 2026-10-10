import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7058_FLAGS_PAGE_URL_FILTERS_FLAG = "htpr-7058-flags-page-url-filters";

export default {
  key: HTPR_7058_FLAGS_PAGE_URL_FILTERS_FLAG,
  kind: "feature",
  defaultMode: "OWNER_AND_QA",
  shippedOn: "2026-10-09",
  description: "Makes admin flag filters shareable in the URL, adds multi-type filtering and shows days waiting for release.",
  releaseRisk: {
    "risk": "new",
    "reason": "The flags page adds shareable type and release-risk filters to help decide what to release."
  },
} as const satisfies FeatureFlagDefinition;
