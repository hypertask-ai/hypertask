import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_6899_STABLE_LAYOUT_FLAG = "htpr-6899-stable-layout";

export default {
  key: HTPR_6899_STABLE_LAYOUT_FLAG,
  shippedOn: "2026-10-03",
  description:
    "Keeps cached tickets steady while comments, summaries, pages and properties load.",
  releaseRisk: {
    "risk": "small",
    "reason": "Ticket content keeps its position while comments and properties finish loading."
  },
  kind: "feature",
} as const satisfies FeatureFlagDefinition;
