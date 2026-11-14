import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_8992_STICKY_TITLE_FLAG = "htpr-8992-sticky-title";

export default {
  key: HTPR_8992_STICKY_TITLE_FLAG,
  kind: "feature",
  defaultMode: "OWNER_AND_QA",
  shippedOn: "2026-11-10",
  description:
    "Ticket detail sticky title keeps the full bar and shows a 1px divider line under it once the page is scrolled, so content scrolls under a clear edge. On mobile the title divider uses a token that stays visible in dark themes.",
  releaseRisk: {
    risk: "new",
    reason:
      "Visible UI change to the ticket detail header under design review. Off keeps the header exactly as today.",
  },
} as const satisfies FeatureFlagDefinition;
