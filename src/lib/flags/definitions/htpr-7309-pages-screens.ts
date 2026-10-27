import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7309_PAGES_SCREENS_FLAG = "htpr-7309-pages-screens";

export default {
  key: HTPR_7309_PAGES_SCREENS_FLAG,
  kind: "feature",
  shippedOn: "2026-10-26",
  defaultMode: "EVERYONE",
  description: "Shows the approved Pages list, linked tickets and page commands when standalone pages are enabled.",
  releaseRisk: {
    risk: "new",
    reason: "Adds document navigation using existing board permissions and standalone-page APIs.",
  },
} as const satisfies FeatureFlagDefinition;
