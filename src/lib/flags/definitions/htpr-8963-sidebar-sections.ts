import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_8963_SIDEBAR_SECTIONS_FLAG = "htpr-8963-sidebar-sections";

export default {
  key: HTPR_8963_SIDEBAR_SECTIONS_FLAG,
  kind: "feature",
  defaultMode: "OWNER_AND_QA",
  shippedOn: "2026-11-10",
  description:
    "Full-screen AI chat rail sections (Pinned, Today, Previous 7 days, Older) collapse and expand from their headers, and a pinned chat keeps a pin mark. Off leaves every section open and the pin on hover only.",
  releaseRisk: {
    risk: "new",
    reason:
      "Visible UI change on the full-screen chat rail under design review. Off restores static section headers and the hover-only pin.",
  },
} as const satisfies FeatureFlagDefinition;
