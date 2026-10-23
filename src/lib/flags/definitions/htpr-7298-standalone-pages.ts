import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7298_STANDALONE_PAGES_FLAG = "htpr-7298-standalone-pages";

export default {
  key: HTPR_7298_STANDALONE_PAGES_FLAG,
  kind: "feature",
  shippedOn: "2026-10-18",
  defaultMode: "OWNER_AND_QA",
  description: "Enables browser-session standalone page creation, ticket linking and board page lists.",
  releaseRisk: {
    risk: "new",
    reason: "Introduces board-owned pages with multiple ticket links and a forward-only nullable-task lifecycle.",
  },
} as const satisfies FeatureFlagDefinition;
