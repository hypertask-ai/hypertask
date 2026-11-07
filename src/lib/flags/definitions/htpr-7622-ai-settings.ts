import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7622_AI_SETTINGS_FLAG = "htpr-7622-ai-settings";

export default {
  key: HTPR_7622_AI_SETTINGS_FLAG,
  kind: "feature",
  shippedOn: "2026-10-24",
  defaultMode: "OWNER_AND_QA",
  description: "Ask the existing AI chat beside Settings to propose a page-scoped change, confirm Apply, and Undo. Off keeps manual settings unchanged.",
  releaseRisk: {
    risk: "new",
    highRisk: "access",
    reason: "AI can propose board member role changes. Only the board owner may apply or undo them, through the existing app action, after explicit confirmation.",
  },
} as const satisfies FeatureFlagDefinition;
